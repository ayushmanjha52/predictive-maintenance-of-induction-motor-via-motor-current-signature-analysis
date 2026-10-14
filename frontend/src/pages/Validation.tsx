import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../api";
import { Banner, Button, PageHeader, Panel, PanelSkeleton, ViewToggle } from "../components/ui";
import { usePageMeta, usePrefersReducedMotion } from "../hooks";
import { axisTick, C, fmt, heatColor, inkOn, MONO, SEVERITY_SHORT } from "../theme";
import type { Validation } from "../types";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface min-w-0 rounded-panel p-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-3 font-mono text-[30px] font-medium tracking-[-0.02em] text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

function BarTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: { load: string; acc: number; n_correct: number; n_test: number } }[];
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-line bg-sunken/95 px-3 py-2 font-mono text-xs shadow-lg">
      <div className="font-semibold text-ink">{row.acc.toFixed(1)}%</div>
      <div className="text-ink-2">
        {row.n_correct}/{row.n_test} correct · held-out load {row.load}%
      </div>
    </div>
  );
}

function ConfusionMatrix({ labels, counts }: { labels: string[]; counts: number[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mx-auto border-separate border-spacing-0.5 text-center">
        <caption className="sr-only">
          Confusion matrix pooled over all leave-one-load-out folds. Rows are the true severity, columns the predicted
          severity.
        </caption>
        <thead>
          <tr>
            <td />
            <th colSpan={labels.length} scope="colgroup" className="pb-2 text-xs font-medium text-ink-3">
              Predicted
            </th>
          </tr>
          <tr>
            <th scope="col" className="pb-1 pr-2 text-left text-xs font-medium text-ink-3">
              True
            </th>
            {labels.map((_, j) => (
              <th key={j} scope="col" className="min-w-12 px-1 pb-1 text-[11px] font-medium text-ink-2 sm:min-w-16">
                {SEVERITY_SHORT[j]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {counts.map((row, i) => {
            const total = row.reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={i}>
                <th scope="row" className="pr-2 text-left text-[11px] font-medium whitespace-nowrap text-ink-2">
                  {SEVERITY_SHORT[i]}
                </th>
                {row.map((n, j) => {
                  const frac = n / total;
                  const rgb = heatColor(frac);
                  return (
                    <td
                      key={j}
                      className="h-12 rounded-md font-mono sm:h-14"
                      style={{ background: `rgb(${rgb.join(",")})`, color: inkOn(rgb) }}
                      title={`True ${labels[i]}, predicted ${labels[j]}: ${n} of ${total} (${(frac * 100).toFixed(0)}%)`}
                    >
                      <span className="block text-sm font-medium">{n}</span>
                      <span className="block text-[10px] opacity-80">{(frac * 100).toFixed(0)}%</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ValidationPage() {
  usePageMeta(
    "Model validation",
    "Leave-one-load-out accuracy of the RandomForest severity classifier per held-out load, with the pooled confusion matrix, computed at server start.",
  );
  const { data, error, loading, retry } = useApi<Validation>("/validation");
  const [view, setView] = useState<"chart" | "table">("chart");
  const reduced = usePrefersReducedMotion();

  if (error) {
    return (
      <div>
        <PageHeader eyebrow="03 — Model validation" title="Model validation" />
        <Banner tone="error" title="Couldn't load validation results" action={<Button onClick={retry}>Retry</Button>}>
          {error.message}
        </Banner>
      </div>
    );
  }

  const synthetic = data?.data_source === "synthetic";
  const rows =
    data?.per_load.map((p) => ({
      load: String(p.load_pct),
      acc: p.accuracy * 100,
      n_correct: p.n_correct,
      n_test: p.n_test,
    })) ?? [];
  const lightLoads = rows.filter((r) => Number(r.load) < 30).map((r) => r.load);
  const totalCorrect = data?.per_load.reduce((a, p) => a + p.n_correct, 0) ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="03 — Model validation"
        title={<>Tested on loads <em>it never saw</em></>}
        lead="Leave-one-load-out: for each load level, the RandomForest is trained on every other load and tested on the one it has never seen. This is a stricter test than a random split, because the model can't memorise a load condition."
      />

      {loading || !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
          <PanelSkeleton height={300} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Mean accuracy" value={fmt.pct(data.mean_accuracy)} sub={`average of ${data.per_load.length} held-out loads`} />
            <StatTile
              label="Pooled accuracy"
              value={fmt.pct(data.overall_accuracy)}
              sub={`${fmt.num(totalCorrect)} of ${fmt.num(data.n_recordings)} recordings`}
            />
            <StatTile
              label="Majority-class baseline"
              value={fmt.pct(data.baseline_accuracy)}
              sub="always guessing the most common class"
            />
            <StatTile
              label="Recordings"
              value={fmt.num(data.n_recordings)}
              sub={synthetic ? "from the motor simulator" : "measured on the test rig"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Panel
              title="Accuracy per held-out load"
              subtitle="Each bar is a model that never saw that load during training"
              actions={<ViewToggle view={view} onChange={setView} label="Accuracy per load" />}
            >
              {view === "chart" ? (
                <div role="figure" aria-label="Bar chart of leave-one-load-out accuracy for each held-out load">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={rows} margin={{ top: 24, right: 64, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      {lightLoads.length > 0 && (
                        <ReferenceArea
                          x1={lightLoads[0]}
                          x2={lightLoads[lightLoads.length - 1]}
                          fill={C.amber}
                          fillOpacity={0.08}
                          stroke={C.amber}
                          strokeOpacity={0.25}
                          label={{ value: "light load", position: "insideTop", fill: C.ink2, fontSize: 11, fontFamily: MONO }}
                        />
                      )}
                      <XAxis
                        dataKey="load"
                        tick={axisTick}
                        tickLine={false}
                        stroke={C.axis}
                        tickFormatter={(v: string) => `${v}%`}
                        height={30}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tick={axisTick}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <ReferenceLine
                        y={data.baseline_accuracy * 100}
                        stroke={C.ink3}
                        strokeWidth={1}
                        label={{ value: "baseline", position: "right", fill: C.ink3, fontSize: 11, fontFamily: MONO }}
                      />
                      <ReferenceLine
                        y={data.mean_accuracy * 100}
                        stroke={C.ink2}
                        strokeWidth={1}
                        label={{ value: "mean", position: "right", fill: C.ink2, fontSize: 11, fontFamily: MONO }}
                      />
                      <Tooltip content={<BarTip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} isAnimationActive={false} />
                      <Bar
                        dataKey="acc"
                        fill={C.signal}
                        maxBarSize={24}
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={!reduced}
                        animationDuration={600}
                      >
                        <LabelList
                          dataKey="acc"
                          position="top"
                          formatter={(v: unknown) => `${Math.round(Number(v))}%`}
                          style={{ fill: C.ink2, fontSize: 11, fontFamily: MONO }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Leave-one-load-out accuracy per held-out load</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-3">
                      <th scope="col" className="py-2 font-medium">Held-out load</th>
                      <th scope="col" className="py-2 text-right font-medium">Correct</th>
                      <th scope="col" className="py-2 text-right font-medium">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[13px] tabular-nums">
                    {data.per_load.map((p) => (
                      <tr key={p.load_pct} className="border-b border-line/60">
                        <th scope="row" className="py-2 text-left font-normal text-ink-2">
                          {p.load_pct}%{p.load_pct < 30 && <span className="ml-2 text-amber">light</span>}
                        </th>
                        <td className="py-2 text-right text-ink-2">
                          {p.n_correct}/{p.n_test}
                        </td>
                        <td className="py-2 text-right text-ink">{fmt.pct(p.accuracy)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-ink">
                      <th scope="row" className="pt-3 text-left font-medium">Mean</th>
                      <td className="pt-3 text-right font-mono text-ink-2">
                        {totalCorrect}/{data.n_recordings}
                      </td>
                      <td className="pt-3 text-right font-mono">{fmt.pct(data.mean_accuracy)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </Panel>

            <Panel
              title="Confusion matrix"
              subtitle="Pooled over all held-out loads; shading is the share of each true class"
            >
              <ConfusionMatrix labels={data.confusion.labels} counts={data.confusion.counts} />
            </Panel>
          </div>

          <Panel title="How these numbers were produced">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-ink-3">Data</dt>
                <dd className="text-ink">
                  {fmt.num(data.n_recordings)} recordings ({data.confusion.labels.length} rotor conditions ×{" "}
                  {data.per_load.length} loads){" "}
                  {synthetic
                    ? "from the physics-based motor simulator, modelled on the Treml et al. test rig"
                    : "from the Treml et al. (2020) experimental database"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Model</dt>
                <dd className="font-mono text-ink">
                  {data.model.type}, {data.model.n_estimators} trees, min leaf {data.model.min_samples_leaf},{" "}
                  {data.model.class_weight} class weights
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Inputs</dt>
                <dd className="font-mono text-ink">{data.model.inputs.join(", ")}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Folds</dt>
                <dd className="text-ink">
                  {data.per_load.length}, one per load level ({data.per_load.map((p) => `${p.load_pct}%`).join(", ")})
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Computed</dt>
                <dd className="font-mono text-ink">{new Date(data.computed_at).toLocaleString()} at server start</dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}
    </div>
  );
}
