"""API tests, including the hostile inputs an untrusted user could send."""

import io
import struct
import sys
import zlib
from pathlib import Path
from urllib.parse import quote

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.io import savemat

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
import synthetic  # noqa: E402

FS = synthetic.FS


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app, base_url="http://localhost") as c:
        yield c


@pytest.fixture(autouse=True)
def generous_rate_limit(monkeypatch):
    monkeypatch.setattr(main, "limiter", main.RateLimiter(1000))


@pytest.fixture(scope="module")
def phases():
    return synthetic.sample_recording(3, 87.5)


def csv_bytes(ia, ib, ic, header="ia,ib,ic", time_col=None) -> bytes:
    cols = [ia, ib, ic] if time_col is None else [time_col, ia, ib, ic]
    buf = io.StringIO()
    np.savetxt(buf, np.column_stack(cols), delimiter=",", fmt="%.6g",
               header=header if header else "", comments="")
    return buf.getvalue().encode()


def post(client, body=b"", filename=None, **params):
    params.setdefault("load_pct", 87.5)
    headers = {"Content-Type": "application/octet-stream"}
    if filename:
        headers["X-File-Name"] = quote(filename)
    return client.post("/analyse", params=params, content=body, headers=headers)


def error_code(resp):
    return resp.json()["error"]["code"]


# ---------------------------------------------------------------- happy paths

def test_status_and_stats_are_computed(client):
    s = client.get("/status").json()
    assert s["ready"] and s["data_source"] in ("real", "synthetic")
    v = client.get("/validation").json()
    assert len(v["per_load"]) == len(s["loads_pct"])
    assert 0.0 <= v["mean_accuracy"] <= 1.0
    assert sum(map(sum, v["confusion"]["counts"])) == s["n_recordings"]
    d = client.get("/detection-limit").json()
    assert [x["severity"] for x in d["series"]] == [0, 1, 2, 3, 4]


def test_sample_is_flagged_synthetic(client):
    r = post(client, sample="true", sample_severity=4, load_pct=100)
    assert r.status_code == 200
    j = r.json()
    assert j["signal"]["synthetic"] is True
    assert j["signal"]["ground_truth"]["severity"] == 4
    assert abs(sum(p["p"] for p in j["prediction"]["probabilities"]) - 1) < 1e-6
    assert r.headers["cache-control"] == "no-store"


def test_csv_upload(client, phases):
    r = post(client, csv_bytes(*phases), fs=FS, filename="Motor 7 – März.csv")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["signal"]["synthetic"] is False and j["signal"]["format"] == "csv"
    assert j["signal"]["name"] == "Motor 7 – März.csv"  # non-ASCII names survive the header
    assert 59.5 < j["markers"]["f1"] < 60.5


def test_csv_with_time_column_and_odd_headers(client, phases):
    t = np.arange(phases[0].size) / FS
    body = csv_bytes(*phases, header="Time (s),I_a (A),Phase B current,current_c", time_col=t)
    r = post(client, body, fs=FS, filename="rec.csv")
    assert r.status_code == 200, r.text


def test_headerless_csv(client, phases):
    r = post(client, csv_bytes(*phases, header=None), fs=FS, filename="rec.csv")
    assert r.status_code == 200, r.text


def test_mat_upload(client, phases):
    buf = io.BytesIO()
    savemat(buf, {"Ia": phases[0], "Ib": phases[1], "Ic": phases[2], "fs": FS}, do_compression=True)
    r = post(client, buf.getvalue(), fs=FS, filename="rec.mat")
    assert r.status_code == 200, r.text
    assert r.json()["signal"]["format"] == "mat"


def test_light_load_warning(client):
    r = post(client, sample="true", load_pct=12.5)
    codes = [w["code"] for w in r.json()["warnings"]]
    assert "light_load" in codes
    msg = next(w["message"] for w in r.json()["warnings"] if w["code"] == "light_load")
    assert msg == "Sidebands sit within 1 Hz of the fundamental; detection confidence is reduced."


# ---------------------------------------------------------------- bad input

def test_missing_columns(client, phases):
    body = csv_bytes(phases[0], phases[1], phases[2], header="va,vb,vc")
    r = post(client, body, fs=FS, filename="rec.csv")
    assert r.status_code == 400 and error_code(r) == "missing_columns"
    assert "va" in r.json()["error"]["message"]


def test_two_columns_only(client, phases):
    buf = io.StringIO()
    np.savetxt(buf, np.column_stack(phases[:2]), delimiter=",", header="ia,ib", comments="")
    r = post(client, buf.getvalue().encode(), fs=FS, filename="rec.csv")
    assert r.status_code == 400 and error_code(r) == "missing_columns"


def test_wrong_sampling_rate(client, phases):
    r = post(client, csv_bytes(*phases), fs=FS * 2, filename="rec.csv")
    assert r.status_code == 400 and error_code(r) == "wrong_sampling_rate"
    assert "5,000" in r.json()["error"]["message"]  # suggests the right rate


def test_fs_contradicts_time_column(client, phases):
    t = np.arange(phases[0].size) / FS
    r = post(client, csv_bytes(*phases, header="t,ia,ib,ic", time_col=t), fs=FS * 1.5, filename="rec.csv")
    assert error_code(r) == "wrong_sampling_rate"


def test_nan_values(client, phases):
    ia = phases[0].copy()
    ia[100] = np.nan
    r = post(client, csv_bytes(ia, *phases[1:]), fs=FS, filename="rec.csv")
    assert r.status_code == 400 and error_code(r) == "bad_values"


def test_same_signal_three_times(client, phases):
    r = post(client, csv_bytes(phases[0], phases[0], phases[0]), fs=FS, filename="rec.csv")
    assert r.status_code == 400 and error_code(r) == "bad_values"


def test_too_short(client, phases):
    short = [p[: int(FS)] for p in phases]
    r = post(client, csv_bytes(*short), fs=FS, filename="rec.csv")
    assert error_code(r) == "too_short"


@pytest.mark.parametrize("params", [
    {"load_pct": 5}, {"load_pct": 101}, {"f_supply": 400}, {"fs": 10}, {"fs": "abc"},
    {"sample_severity": 9, "sample": "true"},
])
def test_out_of_range_params(client, params):
    r = post(client, b"x", **{"fs": FS, **params})
    assert r.status_code == 422 and error_code(r) == "invalid_input"


def test_fs_required_for_upload(client, phases):
    r = post(client, csv_bytes(*phases), filename="rec.csv")
    assert r.status_code == 422


def test_empty_body(client):
    r = post(client, b"", fs=FS, filename="rec.csv")
    assert error_code(r) == "bad_file"


def test_wrong_extension(client, phases):
    r = post(client, csv_bytes(*phases), fs=FS, filename="evil.exe")
    assert r.status_code == 415


def test_extension_content_mismatch(client, phases):
    r = post(client, csv_bytes(*phases), fs=FS, filename="rec.mat")
    assert r.status_code == 415


def test_binary_garbage(client):
    r = post(client, bytes(range(256)) * 50, fs=FS, filename="rec.csv")
    assert r.status_code == 415


def test_mat_v73_rejected(client):
    body = b"MATLAB 7.3 MAT-file, Platform: x".ljust(512, b" ") + b"\x89HDF\r\n\x1a\n" + b"\0" * 64
    r = post(client, body, fs=FS, filename="rec.mat")
    assert r.status_code == 415 and error_code(r) == "unsupported_mat_version"


def test_mat_zip_bomb_rejected(client):
    header = b"MATLAB 5.0 MAT-file".ljust(116, b" ") + b"\0" * 8 + struct.pack("<H", 0x0100) + b"IM"
    payload = zlib.compress(b"\0" * (450 * 1024 * 1024), 9)  # ~450 MB inflated, <1 MB on the wire
    body = header + struct.pack("<II", 15, len(payload)) + payload
    r = post(client, body, fs=FS, filename="bomb.mat")
    assert r.status_code == 413 and error_code(r) == "too_large"


def test_corrupt_mat(client):
    header = b"MATLAB 5.0 MAT-file".ljust(116, b" ") + b"\0" * 8 + struct.pack("<H", 0x0100) + b"IM"
    r = post(client, header + b"\x0f\0\0\0\x10\0\0\0" + b"notzlib!" * 2, fs=FS, filename="rec.mat")
    assert r.status_code == 400 and error_code(r) == "bad_file"


def test_body_too_large_by_content_length(client):
    r = post(client, b"0" * (main.MAX_UPLOAD_BYTES + 1), fs=FS, filename="big.csv")
    assert r.status_code == 413 and error_code(r) == "too_large"


def test_body_too_large_when_streamed(client):
    chunk = b"0" * (1024 * 1024)
    n_chunks = main.MAX_UPLOAD_BYTES // len(chunk) + 2
    r = client.post("/analyse", params={"fs": FS, "load_pct": 50}, headers={"X-File-Name": "big.csv"},
                    content=(chunk for _ in range(n_chunks)))
    assert r.status_code == 413


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(main, "limiter", main.RateLimiter(2))
    codes = [post(client, sample="true").status_code for _ in range(3)]
    assert codes[:2] == [200, 200] and codes[2] == 429


# ---------------------------------------------------------------- hardening

def test_unknown_route_is_clean_404(client):
    r = client.get("/admin")
    assert r.status_code == 404 and error_code(r) == "not_found"


def test_docs_hidden_outside_development(client):
    if not main.DEV:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_disallowed_host_rejected():
    with TestClient(main.app, base_url="http://evil.example") as c:
        assert c.get("/health").status_code == 400


def test_cors_only_for_allowed_origin(client):
    ok = client.get("/health", headers={"Origin": "http://localhost:5173"})
    bad = client.get("/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


def test_security_headers_on_errors(client):
    r = client.get("/nope")
    for h in ("x-content-type-options", "x-frame-options", "content-security-policy", "x-request-id"):
        assert h in r.headers


def test_no_internal_details_leak(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret path C:/internal/thing")
    monkeypatch.setattr(main, "_run_analysis", boom)
    with TestClient(main.app, base_url="http://localhost", raise_server_exceptions=False) as c:
        r = post(c, sample="true")
    assert r.status_code == 500
    assert "secret" not in r.text and "Traceback" not in r.text
    assert r.json()["error"]["request_id"]
