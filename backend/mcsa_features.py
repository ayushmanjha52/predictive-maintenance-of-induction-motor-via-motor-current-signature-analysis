"""Motor Current Signature Analysis (MCSA) features for broken-rotor-bar detection.

A broken rotor bar makes the rotor field asymmetric.  In the stator current
this shows up as two sidebands around the supply frequency f:

    f_lsb = (1 - 2s) f        f_usb = (1 + 2s) f

where s is the per-unit slip.  The same asymmetry modulates the modulus of the
current Park's vector at 2sf (Extended Park's Vector Approach, EPVA).

Four scalar features are extracted, each expressed in dB relative to the
fundamental so they do not depend on motor size or sensor gain:

    lsb_db         amplitude of the (1-2s)f sideband
    usb_db         amplitude of the (1+2s)f sideband
    epva_db        2sf component of |Park's vector| relative to its mean
    stft_ratio_db  sideband-band energy over fundamental-band energy,
                   averaged over the frames of a short-time Fourier transform

Signals are first decimated to ~2 kHz: everything of interest lies below
~100 Hz, and the shorter arrays make the long, zero-padded FFTs cheap.
A 4-term Blackman-Harris window is used throughout because its -92 dB side
lobes keep the fundamental's leakage below the sidebands, which at light load
sit less than 1 Hz away.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import signal
from scipy.fft import next_fast_len, rfft, rfftfreq

# Nameplate of the motor in the reference dataset (Treml et al., 2020):
# 1 hp, 4 poles, 60 Hz, 1715 rpm rated speed, 34 rotor bars.
RATED_SPEED_RPM = 1715.0
POLE_PAIRS = 2

DECIMATED_FS_TARGET = 2000.0
WINDOW = "blackmanharris"
# Half-width of the Blackman-Harris main lobe, in units of 1/T.
MAIN_LOBE_BINS = 4.0
DB_FLOOR = -140.0


@dataclass
class Spectrum:
    f: np.ndarray
    db: np.ndarray


@dataclass
class Spectrogram:
    t: np.ndarray
    f: np.ndarray
    db: np.ndarray  # shape (len(f), len(t)), dB relative to the fundamental
    bands: list[tuple[str, float, float]]  # (label, f_lo, f_hi)
    window_s: float


@dataclass
class MCSAResult:
    features: dict[str, float]
    f1: float
    f_lsb: float
    f_usb: float
    f_2sf: float
    slip_predicted: float
    slip_estimated: float
    fs_decimated: float
    current_spectrum: Spectrum
    park_spectrum: Spectrum
    stft: Spectrogram
    phase_shift_deg: tuple[float, float]
    notes: list[str] = field(default_factory=list)


def rated_slip(f_supply: float, rated_speed_rpm: float = RATED_SPEED_RPM,
               pole_pairs: int = POLE_PAIRS) -> float:
    sync_rpm = 60.0 * f_supply / pole_pairs
    return (sync_rpm - rated_speed_rpm) / sync_rpm


def slip_from_load(load_pct: float, f_supply: float = 60.0) -> float:
    """Slip of a small induction motor is close to linear in load below rated torque."""
    return rated_slip(f_supply) * load_pct / 100.0


def decimate(x: np.ndarray, fs: float, target: float = DECIMATED_FS_TARGET) -> tuple[np.ndarray, float]:
    """Polyphase resampling with a Kaiser (beta 8.6, ~-90 dB) anti-alias filter."""
    down = int(fs // target)
    if down <= 1:
        return x.astype(np.float64, copy=False), fs
    y = signal.resample_poly(x, 1, down, window=("kaiser", 8.6))
    return y, fs / down


def amplitude_spectrum(x: np.ndarray, fs: float, pad_factor: int = 4) -> tuple[np.ndarray, np.ndarray]:
    """Single-sided amplitude spectrum, scaled so a sinusoid of amplitude A reads A."""
    x = x - np.mean(x)
    w = signal.get_window(WINDOW, len(x), fftbins=False)
    nfft = next_fast_len(len(x) * pad_factor)
    amp = np.abs(rfft(x * w, nfft)) * 2.0 / w.sum()
    return rfftfreq(nfft, 1.0 / fs), amp


def to_db(ratio: np.ndarray | float) -> np.ndarray | float:
    return np.maximum(20.0 * np.log10(np.maximum(ratio, 1e-30)), DB_FLOOR)


def dominant_frequency(x: np.ndarray, fs: float, f_min: float = 0.5) -> float:
    """Frequency of the largest spectral peak above f_min (used to sanity-check fs)."""
    x = x - np.mean(x)
    n = len(x)
    spec = np.abs(rfft(x * np.hanning(n)))
    f = rfftfreq(n, 1.0 / fs)
    spec[f < f_min] = 0.0
    return float(f[int(np.argmax(spec))])


def park_vector_modulus(ia: np.ndarray, ib: np.ndarray, ic: np.ndarray) -> np.ndarray:
    i_d = np.sqrt(2.0 / 3.0) * ia - ib / np.sqrt(6.0) - ic / np.sqrt(6.0)
    i_q = (ib - ic) / np.sqrt(2.0)
    return np.hypot(i_d, i_q)


def _peak_in(f: np.ndarray, amp: np.ndarray, lo: float, hi: float) -> tuple[float, float]:
    idx = np.flatnonzero((f >= lo) & (f <= hi))
    if idx.size == 0:
        return float("nan"), 0.0
    k = idx[int(np.argmax(amp[idx]))]
    return float(f[k]), float(amp[k])


def _phase_at(x: np.ndarray, fs: float, f0: float) -> float:
    t = np.arange(len(x)) / fs
    return float(np.angle(np.sum(x * np.exp(-2j * np.pi * f0 * t))))


def _search_halfwidth(two_sf: float, duration_s: float) -> float:
    """Search ±30% of the predicted 2sf, but never into the fundamental's main lobe."""
    return min(0.3 * two_sf, max(two_sf - 1.5 * MAIN_LOBE_BINS / duration_s, 0.05 * two_sf))


def sideband_features(x: np.ndarray, fs: float, f_supply: float, slip: float) -> dict:
    """Lower/upper sideband levels in dB relative to the fundamental.

    The two sidebands are searched jointly: the offset d around the predicted
    2sf that maximises A(f1 - d) * A(f1 + d), since both sit symmetrically
    about the fundamental.  The chosen offset doubles as a slip estimate.
    """
    duration = len(x) / fs
    f, amp = amplitude_spectrum(x, fs)
    f1, a1 = _peak_in(f, amp, 0.9 * f_supply, 1.1 * f_supply)
    df = f[1] - f[0]
    i1 = int(round(f1 / df))

    two_sf = 2.0 * slip * f1
    hw = _search_halfwidth(two_sf, duration)
    k_lo = max(1, int(np.floor((two_sf - hw) / df)))
    k_hi = max(k_lo, int(np.ceil((two_sf + hw) / df)))
    k_hi = min(k_hi, i1 - 1, len(amp) - 1 - i1)
    ks = np.arange(k_lo, k_hi + 1)
    score = np.log(amp[i1 - ks] + 1e-30) + np.log(amp[i1 + ks] + 1e-30)
    k = int(ks[int(np.argmax(score))])

    lsb = amp[i1 - k] / a1
    usb = amp[i1 + k] / a1
    offset = k * df
    return {
        "f": f, "amp": amp, "f1": f1, "a1": a1,
        "lsb_db": float(to_db(lsb)), "usb_db": float(to_db(usb)),
        "f_lsb": f1 - offset, "f_usb": f1 + offset,
        "slip_estimated": offset / (2.0 * f1),
    }


def epva_feature(ia: np.ndarray, ib: np.ndarray, ic: np.ndarray, fs: float,
                 two_sf: float) -> dict:
    """EPVA: 2sf component of the Park's-vector modulus, in dB relative to its mean."""
    duration = len(ia) / fs
    mod = park_vector_modulus(ia, ib, ic)
    dc = float(np.mean(mod))
    f, amp = amplitude_spectrum(mod, fs)
    hw = _search_halfwidth(two_sf, duration)
    f_pk, a_pk = _peak_in(f, amp, two_sf - hw, two_sf + hw)
    return {"f": f, "amp": amp, "dc": dc, "f_2sf": f_pk,
            "epva_db": float(to_db(a_pk / dc)) if dc > 0 else DB_FLOOR}


def stft_window_seconds(two_sf: float, duration_s: float) -> float:
    """Window long enough that the sidebands fall outside the fundamental's main lobe."""
    return float(np.clip(1.5 * MAIN_LOBE_BINS / two_sf, 1.0, duration_s / 2.0))


def stft_feature(x: np.ndarray, fs: float, f1: float, two_sf: float) -> dict:
    """Mean sideband-band energy over fundamental-band energy across STFT frames."""
    duration = len(x) / fs
    win_s = stft_window_seconds(two_sf, duration)
    nperseg = int(round(win_s * fs))
    noverlap = int(round(0.9 * nperseg))
    nfft = next_fast_len(nperseg * 4)
    f, t, sxx = signal.spectrogram(x - np.mean(x), fs, window=WINDOW, nperseg=nperseg,
                                   noverlap=noverlap, nfft=nfft, scaling="spectrum",
                                   mode="psd")
    bw = 0.25 * two_sf
    bands = [
        ("(1-2s)f", f1 - two_sf - bw, f1 - two_sf + bw),
        ("(1+2s)f", f1 + two_sf - bw, f1 + two_sf + bw),
    ]
    fund = (f >= f1 - bw) & (f <= f1 + bw)
    side = np.zeros_like(f, dtype=bool)
    for _, lo, hi in bands:
        side |= (f >= lo) & (f <= hi)
    e_side = sxx[side].sum(axis=0)
    e_fund = sxx[fund].sum(axis=0)
    ratio = float(np.mean(e_side) / max(float(np.mean(e_fund)), 1e-30))
    ref = float(np.max(sxx[fund])) if fund.any() else float(np.max(sxx))
    db = np.maximum(10.0 * np.log10(np.maximum(sxx / ref, 1e-30)), DB_FLOOR)
    return {"f": f, "t": t, "db": db, "bands": bands, "window_s": win_s,
            "stft_ratio_db": float(10.0 * np.log10(max(ratio, 1e-30)))}


def analyse(ia: np.ndarray, ib: np.ndarray, ic: np.ndarray, fs: float,
            f_supply: float, load_pct: float) -> MCSAResult:
    """Full analysis of one three-phase current record."""
    phases = [decimate(np.asarray(p, dtype=np.float64), fs) for p in (ia, ib, ic)]
    fs_d = phases[0][1]
    a, b, c = (p[0] for p in phases)
    n = min(len(a), len(b), len(c))
    a, b, c = a[:n], b[:n], c[:n]

    slip_pred = slip_from_load(load_pct, f_supply)
    sb = sideband_features(a, fs_d, f_supply, slip_pred)
    f1 = sb["f1"]
    two_sf = 2.0 * slip_pred * f1
    ep = epva_feature(a, b, c, fs_d, two_sf)
    st = stft_feature(a, fs_d, f1, two_sf)

    pa, pb, pc = (_phase_at(p, fs_d, f1) for p in (a, b, c))
    shift_ab = float((np.degrees(pa - pb) + 180.0) % 360.0 - 180.0)
    shift_ac = float((np.degrees(pa - pc) + 180.0) % 360.0 - 180.0)

    features = {
        "lsb_db": sb["lsb_db"],
        "usb_db": sb["usb_db"],
        "epva_db": ep["epva_db"],
        "stft_ratio_db": st["stft_ratio_db"],
    }
    return MCSAResult(
        features=features,
        f1=f1,
        f_lsb=sb["f_lsb"],
        f_usb=sb["f_usb"],
        f_2sf=ep["f_2sf"],
        slip_predicted=slip_pred,
        slip_estimated=sb["slip_estimated"],
        fs_decimated=fs_d,
        current_spectrum=Spectrum(sb["f"], to_db(sb["amp"] / sb["a1"])),
        park_spectrum=Spectrum(ep["f"], to_db(ep["amp"] / ep["dc"]) if ep["dc"] > 0
                               else np.full_like(ep["f"], DB_FLOOR)),
        stft=Spectrogram(st["t"], st["f"], st["db"], st["bands"], st["window_s"]),
        phase_shift_deg=(shift_ab, shift_ac),
    )


def extract_features(ia: np.ndarray, ib: np.ndarray, ic: np.ndarray, fs: float,
                     f_supply: float, load_pct: float) -> dict[str, float]:
    return analyse(ia, ib, ic, fs, f_supply, load_pct).features
