import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrefersReducedMotion, useWidth } from "../hooks";
import { axisTick, C, fmt, MONO } from "../theme";

export interface Marker {
  x: number;
  label: string;
  /** Text sits left of the line ("end"), right of it ("start") or centred above ("middle"). */
  anchor: "start" | "end" | "middle";
  row: 0 | 1;
  emphasis?: boolean;
}

interface Props {
  f: number[];
  db: number[];
  xDomain: [number, number];
  markers: Marker[];
  peaks?: { x: number; y: number }[];
  height?: number;
  ariaLabel: string;
  yLabel: string;
  xTickStep?: number;
}

function MarkerLabel({
  viewBox,
  text,
  anchor,
  row,
  emphasis,
}: {
  viewBox?: { x?: number; y?: number };
  text: string;
  anchor: "start" | "end" | "middle";
  row: number;
  emphasis?: boolean;
}) {
  const x = (viewBox?.x ?? 0) + (anchor === "start" ? 5 : anchor === "end" ? -5 : 0);
  const y = (viewBox?.y ?? 0) - 22 + row * 14;
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={emphasis ? C.ink : C.ink2}
      fontSize={11}
      fontFamily={MONO}
    >
      {text}
    </text>
  );
}

function SpecTooltip({
  active,
  payload,
  unitY,
}: {
  active?: boolean;
  payload?: readonly { payload?: { f: number; db: number } }[];
  unitY: string;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-line bg-sunken/95 px-3 py-2 font-mono text-xs shadow-lg">
      <div className="font-semibold text-ink">
        {fmt.signed(row.db, 1)} {unitY}
      </div>
      <div className="text-ink-2">{row.f.toFixed(3)} Hz</div>
    </div>
  );
}

export function SpectrumChart({ f, db, xDomain, markers, peaks = [], height = 300, ariaLabel, yLabel, xTickStep }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const rows = useMemo(() => f.map((x, i) => ({ f: x, db: db[i] })), [f, db]);

  const [yMin, yMax, yTicks] = useMemo(() => {
    const sorted = [...db].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.03)] ?? -100;
    const hi = sorted[sorted.length - 1] ?? 0;
    const yStep = hi - lo > 70 ? 20 : 10;
    const min = Math.max(-140, Math.floor((lo - 4) / yStep) * yStep);
    let max = Math.min(20, Math.ceil(hi / yStep) * yStep);
    if (max - hi < 2) max += 5; // a little headroom above the tallest peak, without an extra tick
    const ticks: number[] = [];
    for (let v = min; v <= max; v += yStep) ticks.push(v);
    return [min, max, ticks];
  }, [db]);

  const step = xTickStep ?? (width && width < 520 ? 5 : 2);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let x = Math.ceil(xDomain[0] / step) * step; x <= xDomain[1] + 1e-9; x += step) out.push(+x.toFixed(4));
    return out;
  }, [xDomain, step]);

  return (
    <div ref={ref} className="trace w-full" role="figure" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 40, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis
            dataKey="f"
            type="number"
            domain={xDomain}
            ticks={ticks}
            allowDataOverflow
            tick={axisTick}
            tickLine={false}
            stroke={C.axis}
            tickFormatter={(v: number) => `${v}`}
            label={{ value: "Hz", position: "insideBottomRight", offset: -2, fill: C.ink3, fontSize: 11, fontFamily: MONO }}
            height={30}
          />
          <YAxis
            domain={[yMin, yMax]}
            ticks={yTicks}
            allowDataOverflow
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => fmt.signed(v, 0)}
            label={{ value: yLabel, position: "top", offset: 14, fill: C.ink3, fontSize: 11, fontFamily: MONO }}
          />
          <Tooltip
            content={<SpecTooltip unitY="dB" />}
            cursor={{ stroke: C.ink3, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {markers.map((m) => (
            <ReferenceLine
              key={m.label}
              x={m.x}
              stroke={m.emphasis ? C.ink2 : C.ink3}
              strokeWidth={1}
              ifOverflow="hidden"
              label={(props: { viewBox?: { x?: number; y?: number } }) => (
                <MarkerLabel {...props} text={m.label} anchor={m.anchor} row={m.row} emphasis={m.emphasis} />
              )}
            />
          ))}
          <Line
            type="linear"
            dataKey="db"
            stroke={C.signal}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, fill: C.signal, stroke: C.panel, strokeWidth: 2 }}
            isAnimationActive={!reduced}
            animationDuration={550}
          />
          {peaks.map((p) => (
            <ReferenceDot
              key={`${p.x}`}
              x={p.x}
              y={p.y}
              r={4.5}
              fill={C.ink}
              stroke={C.panel}
              strokeWidth={2}
              ifOverflow="hidden"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
