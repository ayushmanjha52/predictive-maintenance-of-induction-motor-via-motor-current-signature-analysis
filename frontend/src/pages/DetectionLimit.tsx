import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../api";
import { Banner, Button, PageHeader, Panel, PanelSkeleton, ViewToggle } from "../components/ui";
import { usePageMeta, usePrefersReducedMotion } from "../hooks";
import { axisTick, C, fmt, MONO, SEVERITY_COLORS, SEVERITY_SHORT } from "../theme";
import type { DetectionLimit } from "../types";

type Side = "lsb" | "usb";

function LimitTooltip({
  active,
  payload,
  label,
  side,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; value?: unknown; payload?: Record<string, number> }[];
  label?: unknown;
  side: Side;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  return (
    <div className="min-w-48 rounded-md border border-line bg-sunken/95 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-mono text-ink-2">{String(label)}% load</p>
      <ul className="space-y-1">
        {[4, 3, 2, 1, 0].map((s) => {
          const v = row[`s${s}`];
          if (v == null) return null;
          return (
            <li key={s} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-0.5 w-3.5 rounded" style={{ background: SEVERITY_COLORS[s] }} />
              <span className="font-mono font-semibold text-ink">{fmt.signed(v)} dB</span>
              <span className="font-mono text-ink-3">±{row[`s${s}_${side}_sd`]?.toFixed(1)}</span>
              <span className="ml-auto pl-3 text-ink-2">{SEVERITY_SHORT[s]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function DetectionLimitPage() {
  usePageMeta(
    "Detection limit",
    "How the broken-rotor-bar sideband level changes with motor load for each fault severity, and why light load is hard.",
  );
  const { data, error, loading, retry } = useApi<DetectionLimit>("/detection-limit");
  const [side, setSide] = useState<Side>("lsb");
  const [view, setView] = useState<"chart" | "table">("chart");
  const reduced = usePrefersReducedMotion();

  const rows = useMemo(() => {
    if (!data) return [];
    return data.loads.map((load) => {
      const row: Record<string, number> = { load };
      for (const s of data.series) {
        const p = s.points.find((q) => q.load_pct === load);
        if (!p) continue;
        row[`s${s.severity}`] = side === "lsb" ? p.lsb_mean : p.usb_mean;
        row[`s${s.severity}_lsb_sd`] = p.lsb_std;
        row[`s${s.severity}_usb_sd`] = p.usb_std;
      }
      return row;
    });
  }, [data, side]);

  const yAxis = useMemo(() => {
    const vals = rows.flatMap((r) => [0, 1, 2, 3, 4].map((s) => r[`s${s}`]).filter((v) => v != null));
    if (!vals.length) return { domain: [-80, 0] as [number, number], ticks: [] as number[] };
    const step = Math.max(...vals) - Math.min(...vals) > 30 ? 10 : 5;
    const lo = Math.floor((Math.min(...vals) - 2) / step) * step;
    const hi = Math.ceil((Math.max(...vals) + 2) / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi; v += step) ticks.push(v);
    return { domain: [lo, hi] as [number, number], ticks };
  }, [rows]);

  const insight = useMemo(() => {
    if (!data || rows.length < 2) return null;
    const lo = rows[0];
    const hi = rows[rows.length - 1];
    if (lo.s0 == null || lo.s1 == null || hi.s0 == null || hi.s1 == null) return null;
    const sdLo = Math.max(lo[`s0_${side}_sd`] ?? 0, lo[`s1_${side}_sd`] ?? 0);
    return { loLoad: lo.load, hiLoad: hi.load, gapLo: lo.s1 - lo.s0, gapHi: hi.s1 - hi.s0, sdLo };
  }, [data, rows, side]);

  const synthetic = data?.data_source === "synthetic";
  const sideName = side === "lsb" ? "lower (1−2s)f" : "upper (1+2s)f";

  return (
    <div>
      <PageHeader
        eyebrow="02 — Detection limit"
        title={<>Why light load <em>hides</em> the fault</>}
        lead="A broken bar's sidebands come from current flowing in the rotor, and that current scales with load. At light load the sidebands shrink and move to within about 1 Hz of the much larger fundamental, so the healthy and faulty curves converge."
      />

      {error ? (
        <Banner tone="error" title="Couldn't load the detection-limit data" action={<Button onClick={retry}>Retry</Button>}>
          {error.message}
        </Banner>
      ) : loading || !data ? (
        <PanelSkeleton height={380} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Sideband" className="inline-flex rounded-lg border border-line-strong p-0.5">
              {(
                [
                  ["lsb", "Lower sideband"],
                  ["usb", "Upper sideband"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={side === v}
                  onClick={() => setSide(v)}
                  className={`rounded-md px-3 py-1.5 text-sm ${side === v ? "bg-panel-2 text-ink" : "text-ink-2 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Panel
            title={`Sideband level vs load`}
            subtitle={`Mean ${sideName} level per severity, dB relative to the fundamental · ${fmt.num(
              data.n_recordings,
            )} ${synthetic ? "simulated" : "measured"} recordings`}
            actions={<ViewToggle view={view} onChange={setView} label="Sideband level" />}
          >
            <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-2" aria-label="Legend">
              {data.series.map((s) => (
                <li key={s.severity} className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-0.5 w-4 rounded" style={{ background: SEVERITY_COLORS[s.severity] }} />
                  {s.label}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span aria-hidden="true" className="h-3 w-4 rounded-sm bg-amber/15 ring-1 ring-amber/40" />
                Light load (&lt; {data.light_load_pct}%)
              </li>
            </ul>

            {view === "chart" ? (
              <div role="figure" aria-label={`Line chart of ${sideName} sideband level against load for five severities`}>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={rows} margin={{ top: 20, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <ReferenceArea
                      x1={Math.min(...data.loads) - 2.5}
                      x2={data.light_load_pct}
                      fill={C.amber}
                      fillOpacity={0.08}
                      stroke={C.amber}
                      strokeOpacity={0.25}
                      ifOverflow="hidden"
                      label={{
                        value: "light load",
                        position: "insideTop",
                        fill: C.ink2,
                        fontSize: 11,
                        fontFamily: MONO,
                      }}
                    />
                    <XAxis
                      dataKey="load"
                      type="number"
                      domain={[Math.min(...data.loads) - 2.5, 102.5]}
                      ticks={data.loads}
                      tick={axisTick}
                      tickLine={false}
                      stroke={C.axis}
                      tickFormatter={(v: number) => `${v}%`}
                      height={30}
                    />
                    <YAxis
                      tick={axisTick}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      domain={yAxis.domain}
                      ticks={yAxis.ticks}
                      tickFormatter={(v: number) => fmt.signed(v, 0)}
                    />
                    <Tooltip
                      content={<LimitTooltip side={side} />}
                      cursor={{ stroke: C.ink3, strokeWidth: 1 }}
                      isAnimationActive={false}
                    />
                    {data.series.map((s) => (
                      <Line
                        key={s.severity}
                        type="monotone"
                        dataKey={`s${s.severity}`}
                        name={s.label}
                        stroke={SEVERITY_COLORS[s.severity]}
                        strokeWidth={2}
                        dot={{ r: 4, fill: SEVERITY_COLORS[s.severity], stroke: C.panel, strokeWidth: 2 }}
                        activeDot={{ r: 5.5, stroke: C.panel, strokeWidth: 2 }}
                        isAnimationActive={!reduced}
                        animationDuration={600}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-140 text-sm">
                  <caption className="sr-only">Mean {sideName} level ± standard deviation, dB</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-3">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Load
                      </th>
                      {data.series.map((s) => (
                        <th key={s.severity} scope="col" className="py-2 pr-3 text-right font-medium">
                          {SEVERITY_SHORT[s.severity]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[13px] tabular-nums">
                    {rows.map((r) => (
                      <tr key={r.load} className="border-b border-line/60">
                        <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">
                          {r.load}%
                        </th>
                        {data.series.map((s) => (
                          <td key={s.severity} className="py-2 pr-3 text-right text-ink">
                            {r[`s${s.severity}`] != null ? fmt.signed(r[`s${s.severity}`]) : "—"}
                            <span className="text-ink-3"> ±{r[`s${s.severity}_${side}_sd`]?.toFixed(1)}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {insight && (
            <Panel title="What the curves show">
              <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
                At {insight.hiLoad}% load the mean 1-bar level is{" "}
                <span className="font-mono text-ink">{fmt.signed(insight.gapHi)} dB</span> relative to healthy. At{" "}
                {insight.loLoad}% load the difference is{" "}
                <span className="font-mono text-ink">{fmt.signed(insight.gapLo)} dB</span>, against a test-to-test
                spread of up to <span className="font-mono text-ink">{insight.sdLo.toFixed(1)} dB</span> (one standard
                deviation).{" "}
                {Math.abs(insight.gapLo) < 2 * insight.sdLo
                  ? "That gap is within two standard deviations, so a single light-load recording can't reliably separate a healthy rotor from one broken bar."
                  : "Even at that load the gap is larger than two standard deviations in this data."}
              </p>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
