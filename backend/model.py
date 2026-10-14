"""RandomForest severity classifier and the statistics shown in the UI.

Everything here is computed from the features file when the server starts.
No metric is stored or hard-coded anywhere.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix

log = logging.getLogger("motorscope.model")

FEATURE_COLUMNS = ["lsb_db", "usb_db", "epva_db", "stft_ratio_db"]
MODEL_INPUTS = FEATURE_COLUMNS + ["load_pct"]
REQUIRED_COLUMNS = ["severity", "load_pct", *FEATURE_COLUMNS]
CLASSES = [0, 1, 2, 3, 4]
CLASS_LABELS = {0: "Healthy", 1: "1 broken bar", 2: "2 broken bars",
                3: "3 broken bars", 4: "4 broken bars"}
LIGHT_LOAD_PCT = 30.0

REAL_FILE = "features.csv"
SYNTHETIC_FILE = "features_synthetic.csv"


class DatasetError(Exception):
    pass


@dataclass
class Dataset:
    df: pd.DataFrame
    source: str  # "real" | "synthetic"
    path: Path


def load_dataset(data_dir: Path) -> Dataset:
    real, synth = data_dir / REAL_FILE, data_dir / SYNTHETIC_FILE
    if real.exists():
        path, source = real, "real"
    elif synth.exists():
        path, source = synth, "synthetic"
    else:
        raise DatasetError(f"No features file in {data_dir}. Run `python build_features.py --synthetic` "
                           "or build features.csv from the real dataset (see README).")
    try:
        df = pd.read_csv(path)
    except Exception as exc:
        raise DatasetError(f"Couldn't read {path.name}: {exc}") from exc

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise DatasetError(f"{path.name} is missing column(s) {missing}. Required: {REQUIRED_COLUMNS}.")
    if "source" in df.columns and (df["source"].astype(str).str.lower() == "synthetic").any():
        source = "synthetic"  # a synthetic file renamed to features.csv is still synthetic

    df = df[REQUIRED_COLUMNS].apply(pd.to_numeric, errors="coerce")
    bad = int(df.isna().any(axis=1).sum())
    if bad:
        log.warning("Dropping %d row(s) with missing or non-numeric values from %s", bad, path.name)
        df = df.dropna()
    df["severity"] = df["severity"].astype(int)
    if not df["severity"].isin(CLASSES).all():
        raise DatasetError(f"{path.name}: severity must be one of {CLASSES}.")
    if df["load_pct"].nunique() < 2:
        raise DatasetError(f"{path.name}: need at least two load levels for leave-one-load-out validation.")
    return Dataset(df.reset_index(drop=True), source, path)


def _new_forest() -> RandomForestClassifier:
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=2, class_weight="balanced",
                                  random_state=42, n_jobs=-1)


def leave_one_load_out(df: pd.DataFrame) -> dict:
    loads = sorted(df["load_pct"].unique())
    per_load, y_true_all, y_pred_all = [], [], []
    for load in loads:
        test = df["load_pct"] == load
        clf = _new_forest().fit(df.loc[~test, MODEL_INPUTS], df.loc[~test, "severity"])
        pred = clf.predict(df.loc[test, MODEL_INPUTS])
        truth = df.loc[test, "severity"].to_numpy()
        n_correct = int(np.sum(pred == truth))
        per_load.append({"load_pct": float(load), "n_test": int(test.sum()),
                         "n_correct": n_correct, "accuracy": n_correct / int(test.sum())})
        y_true_all.extend(truth.tolist())
        y_pred_all.extend(pred.tolist())

    cm = confusion_matrix(y_true_all, y_pred_all, labels=CLASSES)
    accs = [p["accuracy"] for p in per_load]
    return {
        "per_load": per_load,
        "mean_accuracy": float(np.mean(accs)),
        "overall_accuracy": float(np.trace(cm) / cm.sum()),
        "confusion": {"labels": [CLASS_LABELS[c] for c in CLASSES], "counts": cm.tolist()},
        # Accuracy of always predicting the most common class: the bar to beat.
        "baseline_accuracy": float(df["severity"].value_counts(normalize=True).max()),
    }


def detection_limit(df: pd.DataFrame) -> dict:
    series = []
    for sev in CLASSES:
        sub = df[df["severity"] == sev]
        points = []
        for load, grp in sub.groupby("load_pct"):
            points.append({
                "load_pct": float(load), "n": int(len(grp)),
                "lsb_mean": float(grp["lsb_db"].mean()), "lsb_std": float(grp["lsb_db"].std(ddof=0)),
                "usb_mean": float(grp["usb_db"].mean()), "usb_std": float(grp["usb_db"].std(ddof=0)),
            })
        series.append({"severity": sev, "label": CLASS_LABELS[sev], "points": points})
    return {"series": series, "loads": sorted(float(x) for x in df["load_pct"].unique()),
            "light_load_pct": LIGHT_LOAD_PCT}


class ModelBundle:
    def __init__(self, dataset: Dataset):
        df = dataset.df
        self.dataset = dataset
        self.model = _new_forest().fit(df[MODEL_INPUTS], df["severity"])
        self.validation = leave_one_load_out(df)
        self.detection = detection_limit(df)
        self.computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        counts = df["severity"].value_counts().reindex(CLASSES, fill_value=0)
        self.summary = {
            "data_source": dataset.source,
            "features_file": dataset.path.name,
            "n_recordings": int(len(df)),
            "loads_pct": self.detection["loads"],
            "class_counts": {CLASS_LABELS[c]: int(counts[c]) for c in CLASSES},
            "model": {"type": "RandomForestClassifier", "n_estimators": 300,
                      "min_samples_leaf": 2, "class_weight": "balanced",
                      "inputs": MODEL_INPUTS},
            "computed_at": self.computed_at,
        }
        log.info("Model trained on %d %s recordings; LOLO mean accuracy %.3f",
                 len(df), dataset.source, self.validation["mean_accuracy"])

    def predict(self, features: dict[str, float], load_pct: float) -> dict:
        row = pd.DataFrame([{**features, "load_pct": load_pct}])[MODEL_INPUTS]
        proba = self.model.predict_proba(row)[0]
        by_class = dict(zip(self.model.classes_.tolist(), proba.tolist()))
        probs = [float(by_class.get(c, 0.0)) for c in CLASSES]
        label = int(np.argmax(probs))
        return {"severity": label, "label": CLASS_LABELS[label],
                "probabilities": [{"severity": c, "label": CLASS_LABELS[c], "p": probs[c]}
                                  for c in CLASSES]}
