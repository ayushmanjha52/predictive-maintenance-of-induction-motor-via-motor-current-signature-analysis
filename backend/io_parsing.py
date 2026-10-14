"""Parse three-phase current recordings from untrusted .mat / .csv bytes.

Uploads are parsed in memory and never written to disk.  The format is decided
by sniffing the content, not by trusting the filename:

* MATLAB v5 (.mat, -v7 or older).  Compressed variables are inflated
  incrementally first, so a small "zip bomb" file is rejected before scipy
  allocates memory for it.  v7.3 (HDF5) files are rejected with a hint.
* Delimited text (.csv): comma, semicolon, tab or whitespace; an optional
  header row; an optional time column.
"""

from __future__ import annotations

import io
import re
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat


class ParseError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass
class ThreePhase:
    ia: np.ndarray
    ib: np.ndarray
    ic: np.ndarray
    fmt: str
    fs_in_file: float | None = None
    columns: tuple[str, str, str] = ("ia", "ib", "ic")
    notes: list[str] = field(default_factory=list)


MAX_SAMPLES_PER_PHASE = 4_000_000
MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024  # 3 phases × 4M float64 samples fit comfortably
_MAX_WALK_NODES = 20_000
_MAX_WALK_DEPTH = 8

_PHASE_LETTERS = {"a": ("a", "r", "u", "1"), "b": ("b", "s", "v", "2"), "c": ("c", "t", "w", "3")}
_PREFIXES = ("i", "is", "il", "current", "curr", "currentphase", "phase", "ph", "phasecurrent",
             "istator", "statorcurrent", "line", "l")
_SUFFIXES = ("", "current", "curr", "phase")


def _norm(name: object) -> str:
    text = re.sub(r"[\(\[\{].*?[\)\]\}]", "", str(name)).lower()
    return re.sub(r"[^a-z0-9]", "", text)


def _phase_names() -> dict[str, str]:
    table: dict[str, str] = {}
    for phase, letters in _PHASE_LETTERS.items():
        table[phase] = phase  # a bare "a", "b", "c" is accepted; bare r/s/t, u/v/w, 1/2/3 are not
        for letter in letters:
            for pre in _PREFIXES:
                for suf in _SUFFIXES:
                    table[f"{pre}{letter}{suf}"] = phase
            table[f"{letter}current"] = phase
            table[f"{letter}phase"] = phase
    return table


_PHASE_TABLE = _phase_names()
_TIME_NAMES = {"t", "time", "times", "timestamp", "timesec", "seconds", "sec"}
_FS_NAMES = {"fs", "fsample", "samplerate", "samplingrate", "samplingfrequency", "samplefrequency",
             "fsampling", "sr"}


def phase_of(name: object) -> str | None:
    return _PHASE_TABLE.get(_norm(name))


def _safe_label(name: object, limit: int = 40) -> str:
    """Column names are untrusted: printable ASCII only, truncated."""
    text = re.sub(r"[^\x20-\x7e]", "?", str(name))
    return text if len(text) <= limit else text[: limit - 1] + "…"


# --------------------------------------------------------------------------- sniffing

def sniff_format(data: bytes) -> str:
    head = data[:128]
    if head.startswith(b"MATLAB 7.3 MAT-file") or data[512:520] == b"\x89HDF\r\n\x1a\n":
        raise ParseError(
            "unsupported_mat_version",
            "This is a MATLAB v7.3 (HDF5) file, which isn't supported. Re-save it in MATLAB with "
            "save('file.mat', ..., '-v7') or export the three currents to CSV.",
            415,
        )
    if head.startswith(b"MATLAB 5.0 MAT-file"):
        return "mat"
    if b"\x00" in data[:4096]:
        raise ParseError("unsupported_format",
                         "File isn't a MATLAB v5 .mat or a text .csv file.", 415)
    return "csv"


# --------------------------------------------------------------------------- MAT

def _check_mat_inflated_size(data: bytes, limit: int = MAX_DECOMPRESSED_BYTES) -> None:
    """Walk top-level MAT v5 elements and bound the inflated size of compressed ones."""
    if len(data) < 128:
        raise ParseError("bad_file", "The .mat file is truncated.")
    marker = data[126:128]
    if marker == b"IM":
        fmt = "<II"
    elif marker == b"MI":
        fmt = ">II"
    else:
        raise ParseError("bad_file", "The .mat header is corrupt (bad endian marker).")
    pos, total = 128, 0
    while pos + 8 <= len(data):
        dtype, nbytes = struct.unpack(fmt, data[pos:pos + 8])
        if dtype >> 16:  # small data element packed into the tag
            pos += 8
            continue
        pos += 8
        if pos + nbytes > len(data):
            raise ParseError("bad_file", "The .mat file is truncated.")
        if dtype == 15:  # miCOMPRESSED
            inflater = zlib.decompressobj()
            buf = data[pos:pos + nbytes]
            while True:
                try:
                    part = inflater.decompress(buf, 1 << 20)
                except zlib.error:
                    raise ParseError("bad_file", "A compressed variable in the .mat file is corrupt.")
                total += len(part)
                if total > limit:
                    raise ParseError("too_large",
                                     "The .mat file expands to more data than this demo accepts.", 413)
                buf = inflater.unconsumed_tail
                if not buf and not part:
                    break
            pos += nbytes
        else:
            total += nbytes
            if total > limit:
                raise ParseError("too_large", "The .mat file holds more data than this demo accepts.", 413)
            pos += nbytes + (-nbytes % 8)


def _walk(obj, path: str, depth: int, counter: list[int]):
    counter[0] += 1
    if counter[0] > _MAX_WALK_NODES or depth > _MAX_WALK_DEPTH:
        return
    if isinstance(obj, dict):
        for key, val in obj.items():
            if str(key).startswith("__"):
                continue
            yield from _walk(val, f"{path}.{key}" if path else str(key), depth + 1, counter)
    elif isinstance(obj, np.ndarray) and obj.dtype == object:
        for i, val in enumerate(obj.flat):
            yield from _walk(val, f"{path}[{i}]", depth + 1, counter)
    elif isinstance(obj, (list, tuple)):
        for i, val in enumerate(obj):
            yield from _walk(val, f"{path}[{i}]", depth + 1, counter)
    elif isinstance(obj, np.ndarray) and obj.dtype.kind in "fiu":
        yield path, obj
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        yield path, np.asarray(obj, dtype=float)


def _leaf(path: str) -> str:
    parts = re.findall(r"[^.\[\]]+", path)
    return parts[-1] if parts else path


def _resolve_key(tree: dict, key: str) -> np.ndarray:
    node = tree
    for part in re.findall(r"[^.\[\]]+", key):
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, (list, tuple, np.ndarray)) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        else:
            raise ParseError("missing_columns", f"Variable '{_safe_label(key)}' not found in the .mat file.")
    arr = np.asarray(node)
    if arr.dtype.kind not in "fiu":
        raise ParseError("missing_columns", f"Variable '{_safe_label(key)}' isn't numeric.")
    return arr


def parse_mat(data: bytes, keys: tuple[str, str, str] | None = None) -> ThreePhase:
    _check_mat_inflated_size(data)
    try:
        tree = loadmat(io.BytesIO(data), simplify_cells=True)
    except Exception:
        raise ParseError("bad_file", "Couldn't read the .mat file. It may be corrupt or use an "
                                     "unsupported layout.")

    if keys:
        arrays = [np.ravel(_resolve_key(tree, k)).astype(np.float64) for k in keys]
        return ThreePhase(*arrays, fmt="mat", columns=keys)

    leaves = list(_walk(tree, "", 0, [0]))
    fs_in_file = None
    for path, arr in leaves:
        if arr.size == 1 and _norm(_leaf(path)) in _FS_NAMES:
            fs_in_file = float(arr.ravel()[0])
            break

    # 1) three named 1-D vectors of equal length, preferring siblings
    by_parent: dict[str, dict[str, tuple[str, np.ndarray]]] = {}
    for path, arr in leaves:
        vec = np.squeeze(arr)
        if vec.ndim != 1 or vec.size < 16:
            continue
        phase = phase_of(_leaf(path))
        if phase:
            parent = path[: len(path) - len(_leaf(path))]
            by_parent.setdefault(parent, {}).setdefault(phase, (path, vec))
    for parent, found in by_parent.items():
        if len(found) == 3 and len({found[p][1].size for p in "abc"}) == 1:
            names = tuple(found[p][0] for p in "abc")
            return ThreePhase(*(found[p][1].astype(np.float64) for p in "abc"),
                              fmt="mat", fs_in_file=fs_in_file, columns=names)  # type: ignore[arg-type]

    # 2) a single matrix with 3 columns (or 4 with a leading time column)
    for path, arr in leaves:
        if arr.ndim == 2 and (arr.shape[0] in (3, 4) or arr.shape[1] in (3, 4)):
            m = arr if arr.shape[1] in (3, 4) else arr.T
            if m.shape[0] < 16:
                continue
            tp = _from_matrix(m.astype(np.float64), "mat")
            tp.fs_in_file = tp.fs_in_file or fs_in_file
            tp.columns = tuple(f"{path}[:, {i}]" for i in range(3))  # type: ignore[assignment]
            return tp

    seen = ", ".join(_safe_label(p) for p, a in leaves[:8] if a.size > 1) or "none"
    raise ParseError(
        "missing_columns",
        "Couldn't find three phase-current variables in the .mat file. Name them ia, ib, ic "
        f"(or Ia/Ib/Ic, current_a, ...) or store an N×3 matrix. Numeric variables found: {seen}.",
    )


# --------------------------------------------------------------------------- CSV

def _from_matrix(m: np.ndarray, fmt: str) -> ThreePhase:
    fs_in_file = None
    if m.shape[1] == 4:
        t = m[:, 0]
        dt = np.diff(t)
        if not (np.all(np.isfinite(dt)) and np.all(dt > 0)):
            raise ParseError("missing_columns",
                             "Found 4 columns but the first isn't an increasing time column. "
                             "Provide exactly three current columns (ia, ib, ic), optionally after a time column.")
        fs_in_file = 1.0 / float(np.median(dt))
        m = m[:, 1:]
    return ThreePhase(m[:, 0].copy(), m[:, 1].copy(), m[:, 2].copy(), fmt=fmt, fs_in_file=fs_in_file)


def _float_or_none(tok: str) -> float | None:
    try:
        return float(tok)
    except ValueError:
        return None


def parse_csv(data: bytes) -> ThreePhase:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ParseError("bad_file", "The CSV isn't valid UTF-8 text.")
    lines = [ln for ln in text.splitlines()[:50] if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        raise ParseError("bad_file", "The CSV file is empty.")
    first = lines[0]
    sep = next((s for s in (",", ";", "\t") if s in first), r"\s+")
    tokens = [tok.strip().strip('"\'') for tok in re.split(sep, first.strip())]
    has_header = any(_float_or_none(tok) is None for tok in tokens)

    try:
        df = pd.read_csv(io.StringIO(text), sep=sep, header=0 if has_header else None,
                         comment="#", engine="c" if sep != r"\s+" else "python",
                         nrows=MAX_SAMPLES_PER_PHASE + 1, skip_blank_lines=True)
    except Exception:
        raise ParseError("bad_file", "Couldn't parse the CSV. Check that every row has the same "
                                     "number of columns.")
    if len(df) > MAX_SAMPLES_PER_PHASE:
        raise ParseError("too_large", f"The CSV has more than {MAX_SAMPLES_PER_PHASE:,} rows.", 413)

    if has_header:
        cols = {phase_of(c): c for c in df.columns if phase_of(c)}
        time_col = next((c for c in df.columns if _norm(c) in _TIME_NAMES), None)
        if not all(p in cols for p in "abc"):
            missing = [p for p in "abc" if p not in cols]
            seen = ", ".join(_safe_label(c) for c in list(df.columns)[:10])
            raise ParseError(
                "missing_columns",
                f"Missing current column(s) for phase {', '.join(m.upper() for m in missing)}. "
                f"Expected headers like ia, ib, ic (or Ia, current_a, phase_A). Found: {seen}.",
            )
        picked = [cols[p] for p in "abc"]
        try:
            m = df[picked].apply(pd.to_numeric, errors="coerce").to_numpy(np.float64)
        except Exception:
            raise ParseError("bad_values", "Current columns contain non-numeric values.")
        bad = int(np.count_nonzero(~np.isfinite(m)))
        if bad:
            raise ParseError("bad_values", f"Current columns contain {bad:,} empty or non-numeric "
                                           "value(s). Remove or fill them and try again.")
        tp = ThreePhase(m[:, 0].copy(), m[:, 1].copy(), m[:, 2].copy(), fmt="csv",
                        columns=tuple(_safe_label(c) for c in picked))  # type: ignore[arg-type]
        if time_col is not None:
            t = pd.to_numeric(df[time_col], errors="coerce").to_numpy(np.float64)
            dt = np.diff(t)
            if dt.size and np.all(np.isfinite(dt)) and np.all(dt > 0):
                tp.fs_in_file = 1.0 / float(np.median(dt))
        return tp

    m = df.apply(pd.to_numeric, errors="coerce").to_numpy(np.float64)
    if m.shape[1] not in (3, 4):
        raise ParseError("missing_columns",
                         f"Found {m.shape[1]} unnamed column(s). Expected three current columns "
                         "(ia, ib, ic), optionally after a time column, or add a header row.")
    bad = int(np.count_nonzero(~np.isfinite(m)))
    if bad:
        raise ParseError("bad_values", f"The CSV contains {bad:,} empty or non-numeric value(s).")
    return _from_matrix(m, "csv")


# --------------------------------------------------------------------------- entry points

def parse_bytes(data: bytes, mat_keys: tuple[str, str, str] | None = None) -> ThreePhase:
    if not data:
        raise ParseError("bad_file", "The file is empty.")
    fmt = sniff_format(data)
    tp = parse_mat(data, mat_keys) if fmt == "mat" else parse_csv(data)
    for name, arr in zip(("A", "B", "C"), (tp.ia, tp.ib, tp.ic)):
        if arr.size > MAX_SAMPLES_PER_PHASE:
            raise ParseError("too_large",
                             f"Phase {name} has more than {MAX_SAMPLES_PER_PHASE:,} samples.", 413)
        if not np.all(np.isfinite(arr)):
            raise ParseError("bad_values", f"Phase {name} contains NaN or infinite values.")
    if not (tp.ia.size == tp.ib.size == tp.ic.size):
        raise ParseError("bad_values", "The three phases have different lengths "
                                       f"({tp.ia.size:,}, {tp.ib.size:,}, {tp.ic.size:,}).")
    return tp


def parse_path(path: Path, mat_keys: tuple[str, str, str] | None = None) -> ThreePhase:
    return parse_bytes(path.read_bytes(), mat_keys)
