"""MotorScope API: MCSA broken-rotor-bar analysis.

Endpoints
    GET  /health            liveness probe
    GET  /status            data source, dataset summary, citation, input limits
    POST /analyse           analyse an uploaded recording (raw request body) or the demo sample
    GET  /detection-limit   sideband level vs load per severity, from the features file
    GET  /validation        leave-one-load-out accuracy and confusion matrix

Configuration comes from environment variables (optionally a backend/.env
file); see .env.example.  Nothing in this service needs a secret.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import threading
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import unquote

import numpy as np
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

import mcsa_features as mcsa
import synthetic
from io_parsing import ParseError, ThreePhase, parse_bytes, sniff_format
from model import CLASS_LABELS, LIGHT_LOAD_PCT, DatasetError, ModelBundle, load_dataset

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _env_list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


APP_ENV = os.getenv("APP_ENV", "production").strip().lower()
DEV = APP_ENV == "development"
ALLOWED_ORIGINS = _env_list("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
ALLOWED_HOSTS = _env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")
MAX_UPLOAD_BYTES = int(float(os.getenv("MAX_UPLOAD_MB", "50")) * 1024 * 1024)
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "20"))
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT_ANALYSES", "2"))
ENABLE_HSTS = os.getenv("ENABLE_HSTS", "false").strip().lower() == "true"
# Mount point for the API when the site is served by someone else (e.g. "/api" on Vercel).
API_PREFIX = os.getenv("API_PREFIX", "").rstrip("/")
# Only behind a proxy that sets these headers itself (Vercel does); otherwise clients could spoof them.
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").strip().lower() == "true"
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
# Path to the built frontend (frontend/dist). When set, one process serves the site
# at / and the API under /api, which is how the Docker image runs.
FRONTEND_DIST = Path(os.environ["FRONTEND_DIST"]).resolve() if os.getenv("FRONTEND_DIST") else None

FS_MIN, FS_MAX = 250.0, 1_000_000.0
F_SUPPLY_MIN, F_SUPPLY_MAX = 40.0, 70.0
LOAD_MIN, LOAD_MAX = 12.5, 100.0
MIN_DURATION_S = 2.0
LIGHT_LOAD_MESSAGE = "Sidebands sit within 1 Hz of the fundamental; detection confidence is reduced."

CITATION = {
    "authors": "Aline Elly Treml, Rogério Andrade Flauzino, Marcelo Suetake, "
               "Narco Afonso Ravazzoli Maciejewski",
    "title": "Experimental database for detecting and diagnosing rotor broken bar in a "
             "three-phase induction motor",
    "publisher": "IEEE Dataport",
    "year": 2020,
    "doi": "10.21227/fmnm-bn95",
    "url": "https://dx.doi.org/10.21227/fmnm-bn95",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("motorscope")


# --------------------------------------------------------------------------- errors

def error_response(status: int, code: str, message: str, request: Request | None = None,
                   headers: dict | None = None) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) if request is not None else None
    return JSONResponse({"error": {"code": code, "message": message, "request_id": request_id}},
                        status_code=status, headers=headers)


class ServiceUnavailable(Exception):
    pass


# --------------------------------------------------------------------------- middleware

class BodyTooLarge(ParseError):
    def __init__(self) -> None:
        super().__init__("too_large", f"Upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.", 413)


class BodySizeLimitMiddleware:
    """Reject oversized bodies early, by Content-Length or while streaming."""

    def __init__(self, app, max_bytes: int):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        for key, value in scope["headers"]:
            if key == b"content-length":
                if not value.isdigit():
                    return await _raw_error(send, 400, "bad_request", "Invalid Content-Length header.")
                if int(value) > self.max_bytes:
                    exc = BodyTooLarge()
                    return await _raw_error(send, 413, exc.code, exc.message)
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLarge()
            return message

        await self.app(scope, limited_receive, send)


async def _raw_error(send, status: int, code: str, message: str) -> None:
    resp = JSONResponse({"error": {"code": code, "message": message, "request_id": None}}, status_code=status)
    await send({"type": "http.response.start", "status": status, "headers": resp.raw_headers})
    await send({"type": "http.response.body", "body": resp.body})


SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), interest-cohort=()"),
    (b"cross-origin-resource-policy", b"same-site"),
    (b"cross-origin-opener-policy", b"same-origin"),
]
# Who may embed the site in a frame. Hosts that show the app inside their own page
# (e.g. Hugging Face Spaces) need their origin here.
FRAME_ANCESTORS = os.getenv("FRAME_ANCESTORS", "'none'").strip() or "'none'"
API_CSP = (b"content-security-policy",
           f"default-src 'none'; frame-ancestors {FRAME_ANCESTORS}; base-uri 'none'".encode())
WEB_CSP = (b"content-security-policy", (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
    f"frame-ancestors {FRAME_ANCESTORS}").encode())
HSTS = (b"strict-transport-security", b"max-age=63072000; includeSubDomains")
IMMUTABLE = (b"cache-control", b"public, max-age=31536000, immutable")


class SecurityHeadersMiddleware:
    """Request IDs plus security headers on every response, including errors."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = uuid.uuid4().hex[:12]
        scope.setdefault("state", {})["request_id"] = request_id
        path = scope["path"]
        is_docs = path.startswith(("/docs", "/openapi.json"))
        is_web = FRONTEND_DIST is not None and not path.startswith("/api/") and not is_docs

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(SECURITY_HEADERS)
                headers.append((b"x-request-id", request_id.encode()))
                if FRAME_ANCESTORS == "'none'":
                    headers.append((b"x-frame-options", b"DENY"))
                if is_web:
                    headers.append(WEB_CSP)
                    if path.startswith("/assets/"):
                        headers.append(IMMUTABLE)  # file names carry a content hash
                elif not is_docs:
                    headers.append(API_CSP)
                if ENABLE_HSTS:
                    headers.append(HSTS)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RateLimiter:
    """Sliding-window limit per client address (in memory, per process)."""

    def __init__(self, limit: int, window_s: float = 60.0):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque[float]] = {}
        self.lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def retry_after(self, key: str) -> float | None:
        now = time.monotonic()
        with self.lock:
            if now - self._last_sweep > self.window:
                # Forget clients with no request inside the window.
                for k in [k for k, v in self.hits.items() if not v or now - v[-1] > self.window]:
                    del self.hits[k]
                self._last_sweep = now
            q = self.hits.setdefault(key, deque())
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return self.window - (now - q[0])
            q.append(now)
        return None


# --------------------------------------------------------------------------- app

_model_lock = threading.Lock()
_model_state: dict[str, ModelBundle | None] = {}


def _load_model() -> ModelBundle | None:
    """Train once per process; later calls return the same bundle (or None if the data is unusable)."""
    with _model_lock:
        if "bundle" not in _model_state:
            try:
                _model_state["bundle"] = ModelBundle(load_dataset(DATA_DIR))
            except DatasetError as exc:
                log.error("Model unavailable: %s", exc)
                _model_state["bundle"] = None
        return _model_state["bundle"]


async def _get_model() -> ModelBundle | None:
    if "bundle" in _model_state:
        return _model_state["bundle"]
    return await run_in_threadpool(_load_model)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Serverless hosts may never run this hook, so _get_model() also loads lazily on first request.
    await _get_model()
    yield


app = FastAPI(
    title="MotorScope API",
    version="1.0.0",
    lifespan=lifespan,
    debug=False,
    docs_url="/docs" if DEV else None,
    redoc_url=None,
    openapi_url="/openapi.json" if DEV else None,
)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_UPLOAD_BYTES)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-File-Name"],
    expose_headers=["X-Request-ID", "Retry-After"],
    allow_credentials=False,
    max_age=600,
)
app.add_middleware(SecurityHeadersMiddleware)

limiter = RateLimiter(RATE_LIMIT_PER_MIN)
analysis_slots = asyncio.Semaphore(MAX_CONCURRENT)


@app.exception_handler(ParseError)
async def _parse_error(request: Request, exc: ParseError):
    return error_response(exc.status, exc.code, exc.message, request)


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError):
    problems = []
    for err in exc.errors():
        field = ".".join(str(p) for p in err.get("loc", []) if p not in ("query", "body"))
        problems.append(f"{field or 'request'}: {err.get('msg', 'invalid value')}")
    return error_response(422, "invalid_input", "; ".join(problems) or "Invalid request.", request)


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, exc: StarletteHTTPException):
    codes = {404: "not_found", 405: "method_not_allowed", 400: "bad_request"}
    message = {404: "Not found.", 405: "Method not allowed."}.get(exc.status_code, "Request failed.")
    return error_response(exc.status_code, codes.get(exc.status_code, "http_error"), message, request)


@app.exception_handler(ServiceUnavailable)
async def _unavailable(request: Request, exc: ServiceUnavailable):
    return error_response(503, "unavailable", str(exc), request, headers={"Retry-After": "30"})


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error (request %s)", getattr(request.state, "request_id", "?"))
    return error_response(500, "internal_error",
                          "Something went wrong on the server. Please try again; if it keeps "
                          "happening, report the request ID.", request)


def _client_ip(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for", "").split(",")[0]
        if forwarded.strip():
            return forwarded.strip()
    return request.client.host if request.client else "unknown"


async def _bundle() -> ModelBundle:
    bundle = await _get_model()
    if bundle is None:
        raise ServiceUnavailable("The model isn't available: the features file is missing or invalid. "
                                 "The server log has details.")
    return bundle


# --------------------------------------------------------------------------- helpers

def _finite(x: float, digits: int = 4) -> float | None:
    return round(float(x), digits) if math.isfinite(x) else None


def _window_max(f: np.ndarray, y: np.ndarray, lo: float, hi: float, max_points: int):
    """Crop to [lo, hi] and downsample by bucket maxima so narrow peaks survive."""
    mask = (f >= lo) & (f <= hi)
    f, y = f[mask], y[mask]
    if len(f) > max_points:
        k = math.ceil(len(f) / max_points)
        n = len(f) // k * k
        idx = np.argmax(y[:n].reshape(-1, k), axis=1) + np.arange(0, n, k)
        f, y = f[idx], y[idx]
    return np.round(f, 4).tolist(), np.round(y, 2).tolist()


def _stft_payload(st: mcsa.Spectrogram, f1: float, two_sf: float, max_t: int = 160, max_f: int = 160):
    span = min(10.0, max(3.0 * two_sf, 3.0))
    mask = (st.f >= f1 - span) & (st.f <= f1 + span)
    f, db = st.f[mask], st.db[mask]
    if len(f) > max_f:
        k = math.ceil(len(f) / max_f)
        n = len(f) // k * k
        f = f[:n].reshape(-1, k).mean(axis=1)
        db = db[:n].reshape(-1, k, db.shape[1]).max(axis=1)
    t = st.t
    if len(t) > max_t:
        idx = np.linspace(0, len(t) - 1, max_t).round().astype(int)
        t, db = t[idx], db[:, idx]
    return {
        "t": np.round(t, 3).tolist(),
        "f": np.round(f, 4).tolist(),
        "db": np.round(db, 1).tolist(),
        "bands": [{"label": lbl, "f_lo": round(lo, 4), "f_hi": round(hi, 4)} for lbl, lo, hi in st.bands],
        "window_s": round(st.window_s, 3),
    }


def _check_signals(tp: ThreePhase, fs: float, f_supply: float) -> list[dict]:
    n = tp.ia.size
    duration = n / fs
    if duration < MIN_DURATION_S:
        raise ParseError("too_short", f"The recording is {duration:.2f} s long at fs = {fs:,.0f} Hz; "
                                      f"at least {MIN_DURATION_S:.0f} s are needed (10 s or more recommended).")
    for name, arr in zip("ABC", (tp.ia, tp.ib, tp.ic)):
        if float(np.std(arr)) == 0.0:
            raise ParseError("bad_values", f"Phase {name} is constant (every sample is equal).")
    if tp.fs_in_file and abs(tp.fs_in_file - fs) / fs > 0.01:
        raise ParseError("wrong_sampling_rate",
                         f"The file's time base implies fs ≈ {tp.fs_in_file:,.0f} Hz, but {fs:,.0f} Hz was "
                         "entered. Set the sampling frequency to match the file.")
    f_dom = mcsa.dominant_frequency(tp.ia, fs)
    if abs(f_dom - f_supply) > 0.1 * f_supply:
        hint = f" Try about {fs * f_supply / f_dom:,.0f} Hz." if f_dom > 0 else ""
        raise ParseError("wrong_sampling_rate",
                         f"With fs = {fs:,.0f} Hz the strongest component is at {f_dom:.1f} Hz, not near the "
                         f"{f_supply:g} Hz supply, so the sampling frequency (or supply frequency) is "
                         f"probably wrong.{hint}")
    return []


def _run_analysis(bundle: ModelBundle, tp: ThreePhase, fs: float, f_supply: float, load_pct: float,
                  signal_meta: dict) -> dict:
    warnings = _check_signals(tp, fs, f_supply)
    res = mcsa.analyse(tp.ia, tp.ib, tp.ic, fs, f_supply, load_pct)

    worst_shift = max(abs(abs(s) - 120.0) for s in res.phase_shift_deg)
    if worst_shift > 60.0:
        raise ParseError("bad_values",
                         "The three columns don't look like a three-phase set (phase shifts "
                         f"{res.phase_shift_deg[0]:.0f}° and {res.phase_shift_deg[1]:.0f}°, expected ±120°). "
                         "Check that they hold the currents of three different phases.")
    if worst_shift > 15.0:
        warnings.append({"code": "phase_unbalance",
                         "message": f"Phase shifts are {res.phase_shift_deg[0]:.0f}° and "
                                    f"{res.phase_shift_deg[1]:.0f}° instead of ±120°; check the column order. "
                                    "The Park's-vector result may be unreliable."})

    two_sf = 2.0 * res.slip_predicted * res.f1
    duration = tp.ia.size / fs
    if load_pct < LIGHT_LOAD_PCT:
        warnings.append({"code": "light_load", "message": LIGHT_LOAD_MESSAGE})
    needed = 1.5 * mcsa.MAIN_LOBE_BINS / two_sf
    if duration < needed:
        warnings.append({"code": "short_record",
                         "message": f"At {load_pct:g}% load the sidebands are only {two_sf:.2f} Hz from the "
                                    f"fundamental; a {duration:.1f} s recording can't fully separate them. "
                                    f"Use at least {math.ceil(needed)} s."})

    prediction = bundle.predict(res.features, load_pct)
    zoom_lo, zoom_hi = f_supply - 10.0, f_supply + 10.0
    park_hi = max(10.0, 2.0 * two_sf)
    spec_f, spec_db = _window_max(res.current_spectrum.f, res.current_spectrum.db, zoom_lo, zoom_hi, 1200)
    park_f, park_db = _window_max(res.park_spectrum.f, res.park_spectrum.db, 0.25, park_hi, 800)

    return {
        "signal": {**signal_meta, "fs": fs, "n_samples": int(tp.ia.size),
                   "duration_s": round(duration, 3), "columns": list(tp.columns),
                   "format": tp.fmt},
        "params": {"f_supply": f_supply, "load_pct": load_pct,
                   "slip_predicted": _finite(res.slip_predicted, 5),
                   "slip_estimated": _finite(res.slip_estimated, 5),
                   "fs_analysis": _finite(res.fs_decimated, 2)},
        "features": {k: _finite(v, 2) for k, v in res.features.items()},
        "markers": {"f1": _finite(res.f1), "f_lsb": _finite(res.f_lsb), "f_usb": _finite(res.f_usb),
                    "f_2sf": _finite(res.f_2sf), "two_sf_predicted": _finite(two_sf)},
        "spectrum": {"f": spec_f, "db": spec_db, "f_lo": zoom_lo, "f_hi": zoom_hi},
        "park": {"f": park_f, "db": park_db, "f_lo": 0.0, "f_hi": park_hi},
        "stft": _stft_payload(res.stft, res.f1, two_sf),
        "prediction": prediction,
        "model": {"data_source": bundle.dataset.source, "n_recordings": int(len(bundle.dataset.df))},
        "warnings": warnings,
    }


# --------------------------------------------------------------------------- routes

router = APIRouter()

@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/status")
async def status(request: Request):
    bundle = await _get_model()
    return {
        "ready": bundle is not None,
        **(bundle.summary if bundle else {"data_source": None}),
        "citation": CITATION,
        "limits": {"max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024), "fs_min": FS_MIN, "fs_max": FS_MAX,
                   "f_supply_min": F_SUPPLY_MIN, "f_supply_max": F_SUPPLY_MAX,
                   "load_min": LOAD_MIN, "load_max": LOAD_MAX, "min_duration_s": MIN_DURATION_S,
                   "light_load_pct": LIGHT_LOAD_PCT},
        "sample": {"fs": synthetic.FS, "duration_s": synthetic.DURATION_S, "f_supply": synthetic.F_SUPPLY,
                   "synthetic": True},
    }


@router.get("/detection-limit")
async def detection_limit(request: Request):
    bundle = await _bundle()
    return {"data_source": bundle.dataset.source, "computed_at": bundle.computed_at,
            "n_recordings": int(len(bundle.dataset.df)), **bundle.detection}


@router.get("/validation")
async def validation(request: Request):
    bundle = await _bundle()
    return {"data_source": bundle.dataset.source, "computed_at": bundle.computed_at,
            "n_recordings": int(len(bundle.dataset.df)), "model": bundle.summary["model"],
            **bundle.validation}


@router.post("/analyse")
async def analyse(
    request: Request,
    load_pct: float = Query(..., ge=LOAD_MIN, le=LOAD_MAX, description="Motor load in % of rated"),
    f_supply: float = Query(60.0, ge=F_SUPPLY_MIN, le=F_SUPPLY_MAX, description="Supply frequency (Hz)"),
    fs: float | None = Query(None, ge=FS_MIN, le=FS_MAX, description="Sampling frequency (Hz)"),
    sample: bool = Query(False, description="Analyse the built-in synthetic demo recording"),
    sample_severity: int = Query(2, ge=0, le=4, description="Broken bars in the demo recording"),
    # Sent as a header, not a query parameter, so file names never land in access logs.
    x_file_name: str | None = Header(None, alias="X-File-Name", max_length=800),
):
    filename = unquote(x_file_name)[:255] if x_file_name else None
    bundle = await _bundle()
    client = _client_ip(request)
    wait = limiter.retry_after(client)
    if wait is not None:
        return error_response(429, "rate_limited",
                              f"Too many analyses. Try again in {math.ceil(wait)} s.", request,
                              headers={"Retry-After": str(math.ceil(wait))})

    if sample:
        tp = ThreePhase(*synthetic.sample_recording(sample_severity, load_pct), fmt="synthetic")
        fs, f_supply = synthetic.FS, synthetic.F_SUPPLY
        meta = {"source": "sample", "synthetic": True, "name": "Sample recording",
                "ground_truth": {"severity": sample_severity, "label": CLASS_LABELS[sample_severity]}}
    else:
        if fs is None:
            raise ParseError("invalid_input", "fs: the sampling frequency is required for uploads.", 422)
        body = await request.body()
        if not body:
            raise ParseError("bad_file", "No file was uploaded.")
        ext = Path(filename).suffix.lower() if filename else None
        if ext not in (None, ".csv", ".mat", ".txt"):
            raise ParseError("unsupported_format", "Only .mat and .csv files are accepted.", 415)
        kind = sniff_format(body)
        if ext == ".mat" and kind != "mat" or ext in (".csv", ".txt") and kind != "csv":
            raise ParseError("unsupported_format",
                             "The file's content doesn't match its extension (.mat files must be MATLAB "
                             "v5/v7 binaries; .csv files must be text).", 415)
        tp = await run_in_threadpool(parse_bytes, body)
        del body
        meta = {"source": "upload", "synthetic": False,
                "name": (Path(filename).name[:120] if filename else f"upload.{kind}"), "ground_truth": None}

    try:
        await asyncio.wait_for(analysis_slots.acquire(), timeout=20.0)
    except asyncio.TimeoutError:
        raise ServiceUnavailable("The server is busy with other analyses. Please try again shortly.")
    try:
        result = await run_in_threadpool(_run_analysis, bundle, tp, fs, f_supply, load_pct, meta)
    finally:
        analysis_slots.release()
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------- site

SPA_ROUTES = {"", "detection-limit", "validation", "about", "privacy"}

if FRONTEND_DIST is None:
    app.include_router(router, prefix=API_PREFIX)
else:
    app.include_router(router, prefix="/api")

    @app.get("/{path:path}", include_in_schema=False)
    async def site(path: str):
        """Built frontend files, with index.html for the app's own routes."""
        if path == "api" or path.startswith("api/"):
            raise StarletteHTTPException(404)
        candidate = (FRONTEND_DIST / path).resolve()
        if path and candidate.is_file() and FRONTEND_DIST in candidate.parents:
            return FileResponse(candidate)
        # Unknown paths still get the app (it renders its own 404 page) but with a real 404 status.
        status_code = 200 if path.strip("/") in SPA_ROUTES else 404
        return FileResponse(FRONTEND_DIST / "index.html", status_code=status_code,
                            headers={"Cache-Control": "no-cache"})
