import { useMemo, useState, type PointerEvent } from "react";
import { useWidth } from "../hooks";
import { C, fmt, heatColor, HEAT_STOPS, MONO } from "../theme";
import type { AnalysisResult } from "../types";

const DB_MIN = -80;
const DB_MAX = 0;
const M = { left: 50, right: 12, top: 8, bottom: 30 };

function niceTicks(lo: number, hi: number, approx: number) {
  const raw = (hi - lo) / Math.max(1, approx);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export function StftHeatmap({ stft, height = 300 }: { stft: AnalysisResult["stft"]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; ti: number; fi: number } | null>(null);
  const { t, f, db, bands } = stft;

  const image = useMemo(() => {
    if (!t.length || !f.length) return "";
    const canvas = document.createElement("canvas");
    canvas.width = t.length;
    canvas.height = f.length;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const img = ctx.createImageData(t.length, f.length);
    for (let fi = 0; fi < f.length; fi++) {
      const row = f.length - 1 - fi; // highest frequency on top
      for (let ti = 0; ti < t.length; ti++) {
        const v = (db[fi][ti] - DB_MIN) / (DB_MAX - DB_MIN);
        const [r, g, b] = heatColor(v);
        const k = (row * t.length + ti) * 4;
        img.data[k] = r;
        img.data[k + 1] = g;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  }, [t, f, db]);

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const df = f.length > 1 ? f[1] - f[0] : 1;
  const dt = t.length > 1 ? t[1] - t[0] : 1;
  const f0 = f[0] - df / 2;
  const f1 = f[f.length - 1] + df / 2;
  const t0 = t[0] - dt / 2;
  const t1 = t[t.length - 1] + dt / 2;
  const yOf = (hz: number) => M.top + ((f1 - hz) / (f1 - f0)) * plotH;
  const xOf = (s: number) => M.left + ((s - t0) / (t1 - t0)) * plotW;

  const fTicks = niceTicks(f0, f1, 6);
  const tTicks = niceTicks(t0, t1, width < 480 ? 4 : 7);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    const ti = Math.min(t.length - 1, Math.max(0, Math.floor((px / box.width) * t.length)));
    const fi = Math.min(f.length - 1, Math.max(0, f.length - 1 - Math.floor((py / box.height) * f.length)));
    setHover({ x: px + M.left, y: py + M.top, ti, fi });
  };

  return (
    <div ref={ref} className="relative w-full" role="figure" aria-label="Short-time Fourier transform heatmap">
      {width > 0 && (
        <svg width={width} height={height} className="block" aria-hidden="true">
          <image
            href={image}
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            preserveAspectRatio="none"
            style={{ imageRendering: "pixelated" }}
          />
          {bands.map((b) => (
            <g key={b.label}>
              <rect
                x={M.left}
                y={yOf(b.f_hi)}
                width={plotW}
                height={Math.max(1, yOf(b.f_lo) - yOf(b.f_hi))}
                fill="none"
                stroke={C.ink}
                strokeOpacity={0.85}
                strokeWidth={1}
              />
              <text
                x={M.left + plotW - 6}
                y={yOf(b.f_hi) - 4}
                textAnchor="end"
                fill={C.ink}
                fontSize={11}
                fontFamily={MONO}
                paintOrder="stroke"
                stroke={C.bg}
                strokeWidth={3}
              >
                {b.label}
              </text>
            </g>
          ))}
          {fTicks.map((v) => (
            <g key={`f${v}`}>
              <line x1={M.left - 4} x2={M.left} y1={yOf(v)} y2={yOf(v)} stroke={C.axis} />
              <text x={M.left - 7} y={yOf(v) + 3.5} textAnchor="end" fill={C.ink3} fontSize={11} fontFamily={MONO}>
                {v}
              </text>
            </g>
          ))}
          {tTicks.map((v) => (
            <g key={`t${v}`}>
              <line x1={xOf(v)} x2={xOf(v)} y1={M.top + plotH} y2={M.top + plotH + 4} stroke={C.axis} />
              <text x={xOf(v)} y={M.top + plotH + 17} textAnchor="middle" fill={C.ink3} fontSize={11} fontFamily={MONO}>
                {v}
              </text>
            </g>
          ))}
          <text x={M.left + plotW} y={height - 2} textAnchor="end" fill={C.ink3} fontSize={11} fontFamily={MONO}>
            s
          </text>
          <text x={4} y={M.top + 10} fill={C.ink3} fontSize={11} fontFamily={MONO}>
            Hz
          </text>
          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
          {hover && (
            <line x1={M.left} x2={M.left + plotW} y1={hover.y} y2={hover.y} stroke={C.ink} strokeOpacity={0.35} pointerEvents="none" />
          )}
        </svg>
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-sunken/95 px-3 py-2 font-mono text-xs shadow-lg"
          style={{
            left: Math.min(hover.x + 12, Math.max(0, width - 150)),
            top: Math.max(0, hover.y - 52),
          }}
        >
          <div className="font-semibold text-ink">{fmt.db(db[hover.fi][hover.ti])}</div>
          <div className="text-ink-2">
            {f[hover.fi].toFixed(2)} Hz · {t[hover.ti].toFixed(2)} s
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 pl-12.5 font-mono text-[11px] text-ink-3">
        <span>{DB_MIN} dB</span>
        <span
          aria-hidden="true"
          className="h-2 max-w-48 flex-1 rounded-sm"
          style={{ background: `linear-gradient(to right, ${HEAT_STOPS.join(",")})` }}
        />
        <span>0 dB re fundamental</span>
      </div>
    </div>
  );
}
