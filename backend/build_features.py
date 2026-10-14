"""Build the features file the model is trained on.

Real data (recommended):
    python build_features.py --manifest manifest.csv
        -> data/features.csv

    manifest.csv lists one recording per row:
        path,severity,load_pct,fs[,f_supply][,ia_key,ib_key,ic_key]
    `path` is relative to the manifest.  The *_key columns are optional dotted
    paths to the three currents inside a .mat file (e.g. "rec.Ia"); without
    them the parser looks for variables named ia/ib/ic, Ia/Ib/Ic, ...

Synthetic fallback (demo only, labelled as such everywhere in the UI):
    python build_features.py --synthetic
        -> data/features_synthetic.csv
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

import synthetic
from io_parsing import ParseError, parse_path
from mcsa_features import extract_features
from model import REAL_FILE, SYNTHETIC_FILE

DATA_DIR = Path(__file__).resolve().parent / "data"


def build_synthetic(out: Path) -> pd.DataFrame:
    rows = []
    total = len(synthetic.SEVERITIES) * len(synthetic.LOADS_PCT) * synthetic.REPETITIONS
    t0 = time.time()
    for sev in synthetic.SEVERITIES:
        for li, load in enumerate(synthetic.LOADS_PCT):
            for rep in range(synthetic.REPETITIONS):
                ia, ib, ic = synthetic.simulate(sev, load, synthetic.training_rng(sev, li, rep))
                feats = extract_features(ia, ib, ic, synthetic.FS, synthetic.F_SUPPLY, load)
                rows.append({"recording_id": f"syn_s{sev}_l{li}_r{rep}", "severity": sev,
                             "load_pct": load, **feats, "source": "synthetic"})
            print(f"\r{len(rows)}/{total} recordings  ({time.time() - t0:.0f}s)", end="", flush=True)
    print()
    df = pd.DataFrame(rows)
    df.to_csv(out, index=False, float_format="%.4f")
    return df


def build_from_manifest(manifest: Path, out: Path) -> pd.DataFrame:
    man = pd.read_csv(manifest)
    required = {"path", "severity", "load_pct", "fs"}
    if not required.issubset(man.columns):
        sys.exit(f"manifest needs columns {sorted(required)}; found {list(man.columns)}")
    rows, failures = [], 0
    for i, rec in man.iterrows():
        path = (manifest.parent / str(rec["path"])).resolve()
        keys = None
        if all(k in man.columns and isinstance(rec[k], str) and rec[k] for k in ("ia_key", "ib_key", "ic_key")):
            keys = (rec["ia_key"], rec["ib_key"], rec["ic_key"])
        f_supply = float(rec["f_supply"]) if "f_supply" in man.columns and not pd.isna(rec["f_supply"]) else 60.0
        try:
            tp = parse_path(path, keys)
            feats = extract_features(tp.ia, tp.ib, tp.ic, float(rec["fs"]), f_supply, float(rec["load_pct"]))
        except (ParseError, OSError) as exc:
            failures += 1
            print(f"  skip row {i} ({path.name}): {getattr(exc, 'message', exc)}")
            continue
        rows.append({"recording_id": f"{path.stem}#{i}", "severity": int(rec["severity"]),
                     "load_pct": float(rec["load_pct"]), **feats, "source": "real"})
        print(f"\r{len(rows)} recordings processed", end="", flush=True)
    print()
    if not rows:
        sys.exit("No recordings could be processed.")
    df = pd.DataFrame(rows)
    df.to_csv(out, index=False, float_format="%.4f")
    print(f"{failures} row(s) skipped")
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--synthetic", action="store_true", help="simulate the demo dataset")
    group.add_argument("--manifest", type=Path, help="CSV listing real recordings")
    ap.add_argument("--out", type=Path, help="output path (default: data/features[_synthetic].csv)")
    args = ap.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    if args.synthetic:
        out = args.out or DATA_DIR / SYNTHETIC_FILE
        df = build_synthetic(out)
    else:
        out = args.out or DATA_DIR / REAL_FILE
        df = build_from_manifest(args.manifest, out)
    print(f"wrote {len(df)} rows -> {out}")
    print(df.groupby(["severity"])[["lsb_db", "epva_db"]].agg(["mean", "std"]).round(1).to_string())


if __name__ == "__main__":
    main()
