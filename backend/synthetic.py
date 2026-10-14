"""Synthetic three-phase stator currents for a motor with broken rotor bars.

DEMONSTRATION FALLBACK ONLY.  These signals are used when the real dataset has
not been loaded; every chart and metric derived from them is labelled
SYNTHETIC DEMO DATA in the UI.  They are not measurements and say nothing about
how well the method works on a real motor.

The model is deliberately simple but keeps the physics that makes the problem
hard:

* (1 +/- 2ks)f sidebands (k = 1, 2) whose level grows with the number of broken
  bars and with the torque-producing share of the stator current, so they
  shrink at light load (after Bellini et al., IEEE TIE 2001).
* Supply-frequency wander with a pink spectrum.  It spreads a skirt of energy
  around the fundamental that falls with distance, so it masks sidebands at
  light load (s small, sidebands < 1 Hz away) far more than at full load.
* Inherent rotor asymmetry (a healthy rotor still has small sidebands), a
  random load-torque oscillation that can mimic a fault, 3rd/5th/7th
  harmonics, a small phase unbalance and sensor noise.
"""

from __future__ import annotations

import numpy as np

from mcsa_features import POLE_PAIRS, slip_from_load

FS = 5000.0
DURATION_S = 18.0
F_SUPPLY = 60.0
N_BARS = 34
LOADS_PCT = (12.5, 25.0, 37.5, 50.0, 62.5, 75.0, 87.5, 100.0)
SEVERITIES = (0, 1, 2, 3, 4)
REPETITIONS = 10

_I_MAG_RMS = 1.6
_I_TORQUE_RMS_FULL = 2.6


def _pink_frequency_wander(n: int, fs: float, rms_hz: float, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(n)
    spec = np.fft.rfft(white)
    f = np.fft.rfftfreq(n, 1.0 / fs)
    shape = np.zeros_like(f)
    band = (f >= 0.02) & (f <= 8.0)
    shape[band] = 1.0 / np.sqrt(f[band])
    wander = np.fft.irfft(spec * shape, n)
    return wander * (rms_hz / max(np.std(wander), 1e-12))


def simulate(severity: int, load_pct: float, rng: np.random.Generator,
             fs: float = FS, duration_s: float = DURATION_S,
             f_supply: float = F_SUPPLY) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = int(round(fs * duration_s))
    t = np.arange(n) / fs
    load = load_pct / 100.0

    # Each severity is a physically different rotor with its own fixed quirks.
    rotor = np.random.default_rng([7, severity])
    inherent_asym = 0.12 * rotor.lognormal(0.0, 0.3)
    usb_share = rotor.uniform(0.4, 0.75)

    slip = slip_from_load(load_pct, f_supply) * rng.normal(1.0, 0.03)
    i_torque = _I_TORQUE_RMS_FULL * load
    i_total = np.hypot(_I_MAG_RMS, i_torque)
    amp1 = np.sqrt(2.0) * i_total * rng.normal(1.0, 0.01)
    torque_share = i_torque / i_total

    n_eff = severity + inherent_asym
    k_bb = n_eff / (2.0 * N_BARS / POLE_PAIRS - n_eff)
    lsb = 0.45 * k_bb * torque_share * rng.lognormal(0.0, 0.2)
    usb = lsb * usb_share * rng.lognormal(0.0, 0.15)

    wander = _pink_frequency_wander(n, fs, rms_hz=0.006, rng=rng)
    theta1 = 2.0 * np.pi * np.cumsum(f_supply + wander) / fs + rng.uniform(0, 2 * np.pi)

    # (relative amplitude, frequency offset in units of 2sf, harmonic order)
    comps: list[tuple[float, float, int]] = [
        (1.0, 0.0, 1),
        (lsb, -1.0, 1), (usb, 1.0, 1),
        (0.3 * lsb, -2.0, 1), (0.3 * usb, 2.0, 1),
        (10 ** (-46 / 20), 0.0, 3),
        (10 ** (-30 / 20) * rng.lognormal(0, 0.1), 0.0, 5),
        (10 ** (-36 / 20) * rng.lognormal(0, 0.1), 0.0, 7),
    ]
    if rng.random() < 0.5:
        f_osc = rng.uniform(0.3, 8.0)
        a_osc = 10 ** (rng.uniform(-66.0, -56.0) / 20)
        comps.append((a_osc, -f_osc / (2 * slip * f_supply), 1))
        comps.append((a_osc, f_osc / (2 * slip * f_supply), 1))

    # One random phase per component, shared by all three phases so each
    # component stays a balanced positive-sequence set.
    comp_phase = [rng.uniform(0, 2 * np.pi) if k_off != 0.0 else 0.0 for _, k_off, _ in comps]
    gains = 1.0 + rng.normal(0.0, 0.005, size=3)
    phases_out = []
    for p in range(3):
        shift = -2.0 * np.pi * p / 3.0
        x = np.zeros(n)
        for (rel, k_off, h), phi in zip(comps, comp_phase):
            offset = 2.0 * np.pi * k_off * 2.0 * slip * f_supply * t
            x += rel * np.cos(h * (theta1 + shift) + offset + phi)
        x *= amp1 * gains[p]
        x += rng.normal(0.0, 0.002 * amp1, size=n)
        phases_out.append(x)
    return phases_out[0], phases_out[1], phases_out[2]


def sample_recording(severity: int, load_pct: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Deterministic demo recording, from a seed space disjoint from the training set."""
    rng = np.random.default_rng([99, severity, int(round(load_pct * 10))])
    return simulate(severity, load_pct, rng)


def training_rng(severity: int, load_index: int, rep: int) -> np.random.Generator:
    return np.random.default_rng([2026, severity, load_index, rep])


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Write a synthetic three-phase recording to CSV.")
    ap.add_argument("out")
    ap.add_argument("--severity", type=int, default=3, choices=SEVERITIES)
    ap.add_argument("--load", type=float, default=87.5)
    a = ap.parse_args()
    ia, ib, ic = sample_recording(a.severity, a.load)
    t = np.arange(ia.size) / FS
    np.savetxt(a.out, np.column_stack([t, ia, ib, ic]), delimiter=",", fmt="%.6g",
               header="time_s,ia,ib,ic", comments="")
    print(f"wrote {a.out}: {ia.size} samples at {FS:g} Hz, {a.severity} broken bar(s), {a.load}% load (SYNTHETIC)")
