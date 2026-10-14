/** Chart colors. Text never wears these; they color marks only. */
export const C = {
  bg: "#090908",
  panel: "#121110",
  grid: "#1f1d1b",
  axis: "#33302c",
  ink: "#f2efe9",
  ink2: "#b3ada4",
  ink3: "#938d84",
  signal: "#8ef0b8",
  amber: "#ffb65c",
  fault: "#f26b6b",
} as const;

/**
 * Severity is ordinal: healthy wears the phosphor signal green, broken-bar
 * states wear a one-hue red ramp that brightens with severity (validated on
 * the panel surface: monotone L, adjacent ΔL ≥ 0.06, every step ≥ 3:1, and
 * healthy↔1 bar separated by ΔE 33 under deuteranopia).
 */
export const SEVERITY_COLORS = ["#8ef0b8", "#c03232", "#e04646", "#f26b6b", "#fb9b9b"] as const;

export const SEVERITY_SHORT = ["Healthy", "1 bar", "2 bars", "3 bars", "4 bars"] as const;

export const MONO = "'IBM Plex Mono', ui-monospace, monospace";

export const axisTick = { fill: C.ink3, fontSize: 11, fontFamily: MONO } as const;

/** Sequential phosphor ramp for heatmaps: black → green → pale mint. */
export const HEAT_STOPS = ["#0b0c0b", "#0d1f17", "#0f3a27", "#13603d", "#1f8f58", "#4cc487", "#8ef0b8", "#dcfbe9"];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function heatColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(HEAT_STOPS[i]);
  const b = hexToRgb(HEAT_STOPS[i + 1]);
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}

/** Pick dark or light ink for text sitting on a filled cell. */
export function inkOn([r, g, b]: [number, number, number]): string {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.2 ? C.bg : C.ink;
}

export const fmt = {
  db: (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1).replace("-", "−")} dB`),
  hz: (v: number | null | undefined, d = 2) => (v == null ? "—" : `${v.toFixed(d)} Hz`),
  pct: (v: number, d = 1) => `${(v * 100).toFixed(d)}%`,
  num: (v: number) => v.toLocaleString("en-US"),
  signed: (v: number, d = 1) => v.toFixed(d).replace("-", "−"),
};
