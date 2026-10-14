import { AnimatePresence, m } from "framer-motion";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { analyseFile, analyseSample, ApiError } from "../api";
import { IconFile, IconUpload } from "../components/Icons";
import { Banner, Button, PageHeader, Panel, PanelSkeleton, Skeleton } from "../components/ui";
import { usePageMeta } from "../hooks";
import { useAnalysisState, useStatus } from "../status";
import { fmt, SEVERITY_SHORT } from "../theme";

const loadResults = () => import("./AnalyseResults");
const Results = lazy(loadResults);
const ACCEPT = ".mat,.csv";

type Errors = Partial<Record<"file" | "fs" | "fSupply" | "load", string>>;

function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AnalysePage() {
  usePageMeta(
    "Analyse a recording",
    "Upload a three-phase stator current recording (.mat or .csv) or load a sample and see sidebands, Park's vector, STFT and a broken-bar severity estimate.",
  );
  const { status } = useStatus();
  const [state, update] = useAnalysisState();
  const { mode, sampleSeverity, loadPct, fs, fSupply, file, result } = state;
  const [errors, setErrors] = useState<Errors>({});
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const ids = { fs: useId(), fSupply: useId(), load: useId(), file: useId(), sev: useId() };

  const lim = status?.limits;
  const sampleFs = status?.sample.fs ?? 5000;
  const sampleF = status?.sample.f_supply ?? 60;
  const maxMb = lim?.max_upload_mb ?? 50;
  const lightLoad = loadPct < (lim?.light_load_pct ?? 30);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Fetch the chart code while the user fills in the form, so results render without a wait.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadResults());
  }, []);

  function validate(): Errors {
    const e: Errors = {};
    const loMin = lim?.load_min ?? 12.5;
    const loMax = lim?.load_max ?? 100;
    if (!(loadPct >= loMin && loadPct <= loMax)) e.load = `Load must be between ${loMin}% and ${loMax}%.`;
    if (mode === "upload") {
      if (!file) e.file = "Choose a .mat or .csv file, or switch to the sample.";
      else if (!/\.(mat|csv)$/i.test(file.name)) e.file = "Only .mat and .csv files are accepted.";
      else if (file.size > maxMb * 1024 * 1024) e.file = `The file is ${formatBytes(file.size)}; the limit is ${maxMb} MB.`;
      else if (file.size === 0) e.file = "The file is empty.";
      const fsN = Number(fs);
      const fsMin = lim?.fs_min ?? 250;
      const fsMax = lim?.fs_max ?? 1_000_000;
      if (fs.trim() === "" || !Number.isFinite(fsN)) e.fs = "Enter the sampling frequency in Hz.";
      else if (fsN < fsMin || fsN > fsMax)
        e.fs = `Sampling frequency must be between ${fmt.num(fsMin)} and ${fmt.num(fsMax)} Hz.`;
      const fN = Number(fSupply);
      const fMin = lim?.f_supply_min ?? 40;
      const fMax = lim?.f_supply_max ?? 70;
      if (fSupply.trim() === "" || !Number.isFinite(fN)) e.fSupply = "Enter the supply frequency in Hz.";
      else if (fN < fMin || fN > fMax) e.fSupply = `Supply frequency must be between ${fMin} and ${fMax} Hz.`;
    }
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setApiError(null);
    if (Object.keys(e).length) {
      const firstKey = Object.keys(e)[0] as keyof typeof ids;
      document.getElementById(ids[firstKey === "load" ? "load" : firstKey])?.focus();
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    try {
      const res =
        mode === "sample"
          ? await analyseSample(sampleSeverity, loadPct, ctrl.signal)
          : await analyseFile(file as File, { loadPct, fSupply: Number(fSupply), fs: Number(fs) }, ctrl.signal);
      update({ result: res });
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      if (err instanceof ApiError && err.code !== "cancelled") setApiError(err);
    } finally {
      if (abortRef.current === ctrl) setRunning(false);
    }
  }

  function pickFile(f: File | null) {
    update({ file: f });
    setErrors((e) => ({ ...e, file: undefined }));
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]);
  };

  const fieldCls = (bad?: string) =>
    `w-full rounded-lg border bg-bg px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-3 disabled:text-ink-2 disabled:opacity-70 ${
      bad ? "border-amber" : "border-line-strong hover:border-ink-3"
    }`;

  const fill = ((loadPct - 12.5) / (100 - 12.5)) * 100;

  return (
    <div>
      <PageHeader
        eyebrow="01 — Analyse"
        title={<>Find broken bars <em>in the current</em></>}
        lead="Motor current signature analysis looks for two small sidebands either side of the supply frequency. A broken rotor bar makes them grow. Upload three phase currents or try a sample."
      />

      <form onSubmit={onSubmit} noValidate aria-describedby={apiError ? "analyse-error" : undefined}>
        <Panel title="Input" subtitle="All values are checked again on the server.">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* Source */}
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium text-ink">Signal source</legend>
              <div className="inline-flex rounded-lg border border-line-strong p-0.5">
                {(
                  [
                    ["sample", "Load sample"],
                    ["upload", "Upload file"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-md px-3.5 py-2 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-signal ${
                      mode === value ? "bg-panel-2 text-ink" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={value}
                      checked={mode === value}
                      onChange={() => {
                        update({ mode: value });
                        setErrors({});
                      }}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="mt-4">
                {mode === "sample" ? (
                  <div className="space-y-2">
                    <label htmlFor={ids.sev} className="block text-sm text-ink-2">
                      Condition of the simulated motor
                    </label>
                    <select
                      id={ids.sev}
                      value={sampleSeverity}
                      onChange={(e) => update({ sampleSeverity: Number(e.target.value) })}
                      className={`${fieldCls()} font-sans`}
                    >
                      {SEVERITY_SHORT.map((s, i) => (
                        <option key={s} value={i}>
                          {i === 0 ? "Healthy rotor" : `${i} broken bar${i > 1 ? "s" : ""}`}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs leading-relaxed text-ink-3">
                      A synthetic {status?.sample.duration_s ?? 18} s recording at {fmt.num(sampleFs)} Hz, generated on the
                      server at the load you choose. Results are labelled{" "}
                      <span className="font-mono text-amber">SYNTHETIC DEMO DATA</span>.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor={ids.file}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-signal ${
                        errors.file
                          ? "border-amber"
                          : dragOver
                            ? "border-signal bg-signal-deep/30"
                            : "border-line-strong hover:border-ink-3"
                      }`}
                    >
                      {file ? <IconFile className="text-signal" /> : <IconUpload className="text-ink-2" />}
                      {file ? (
                        <span className="max-w-full truncate text-sm text-ink">
                          {file.name} <span className="font-mono text-ink-3">· {formatBytes(file.size)}</span>
                        </span>
                      ) : (
                        <span className="text-sm text-ink">
                          Drop a file here or <span className="text-signal underline underline-offset-2">browse</span>
                        </span>
                      )}
                      <span className="text-xs text-ink-3">.mat (v5/v7) or .csv · up to {maxMb} MB</span>
                      <input
                        id={ids.file}
                        type="file"
                        accept={ACCEPT}
                        className="sr-only"
                        aria-invalid={!!errors.file}
                        aria-describedby={`${ids.file}-help${errors.file ? ` ${ids.file}-err` : ""}`}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => pickFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {errors.file && (
                      <p id={`${ids.file}-err`} className="mt-2 text-[13px] text-amber">
                        {errors.file}
                      </p>
                    )}
                    <p id={`${ids.file}-help`} className="mt-2 text-xs leading-relaxed text-ink-3">
                      Three columns named <span className="font-mono text-ink-2">ia, ib, ic</span> (an optional{" "}
                      <span className="font-mono text-ink-2">time</span> column is used to check the sampling rate). In
                      .mat files, variables Ia/Ib/Ic or an N×3 matrix. Files are processed in memory and not stored.
                    </p>
                  </div>
                )}
              </div>
            </fieldset>

            {/* Parameters */}
            <div className="grid min-w-0 content-start gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={ids.fs} className="mb-1.5 block text-sm text-ink-2">
                  Sampling frequency (Hz)
                </label>
                <input
                  id={ids.fs}
                  type="number"
                  inputMode="decimal"
                  min={lim?.fs_min ?? 250}
                  max={lim?.fs_max ?? 1_000_000}
                  step="any"
                  placeholder="e.g. 50000"
                  disabled={mode === "sample"}
                  value={mode === "sample" ? sampleFs : fs}
                  onChange={(e) => update({ fs: e.target.value })}
                  aria-invalid={!!errors.fs}
                  aria-describedby={errors.fs ? `${ids.fs}-err` : mode === "sample" ? `${ids.fs}-fixed` : undefined}
                  className={fieldCls(errors.fs)}
                />
                {errors.fs ? (
                  <p id={`${ids.fs}-err`} className="mt-1.5 text-[13px] text-amber">
                    {errors.fs}
                  </p>
                ) : (
                  mode === "sample" && (
                    <p id={`${ids.fs}-fixed`} className="mt-1.5 text-xs text-ink-3">
                      Set by the sample.
                    </p>
                  )
                )}
              </div>
              <div>
                <label htmlFor={ids.fSupply} className="mb-1.5 block text-sm text-ink-2">
                  Supply frequency (Hz)
                </label>
                <input
                  id={ids.fSupply}
                  type="number"
                  inputMode="decimal"
                  min={lim?.f_supply_min ?? 40}
                  max={lim?.f_supply_max ?? 70}
                  step="any"
                  disabled={mode === "sample"}
                  value={mode === "sample" ? sampleF : fSupply}
                  onChange={(e) => update({ fSupply: e.target.value })}
                  aria-invalid={!!errors.fSupply}
                  aria-describedby={errors.fSupply ? `${ids.fSupply}-err` : undefined}
                  className={fieldCls(errors.fSupply)}
                />
                {errors.fSupply && (
                  <p id={`${ids.fSupply}-err`} className="mt-1.5 text-[13px] text-amber">
                    {errors.fSupply}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-baseline justify-between">
                  <label htmlFor={ids.load} className="text-sm text-ink-2">
                    Load
                  </label>
                  <output htmlFor={ids.load} className="font-mono text-sm text-ink">
                    {loadPct.toFixed(1)}%
                  </output>
                </div>
                <input
                  id={ids.load}
                  type="range"
                  min={12.5}
                  max={100}
                  step={2.5}
                  value={loadPct}
                  onChange={(e) => update({ loadPct: Number(e.target.value) })}
                  aria-valuetext={`${loadPct}% load`}
                  aria-describedby={lightLoad ? `${ids.load}-hint` : undefined}
                  className="w-full"
                  style={{ ["--fill" as string]: `${fill}%` }}
                />
                <div className="flex justify-between font-mono text-[11px] text-ink-3" aria-hidden="true">
                  <span>12.5%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
                {errors.load && <p className="mt-1.5 text-[13px] text-amber">{errors.load}</p>}
                {lightLoad && (
                  <p id={`${ids.load}-hint`} className="mt-2 flex gap-2 text-xs leading-relaxed text-amber">
                    Below 30% load the sidebands sit within about 1 Hz of the fundamental, so expect lower confidence.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button type="submit" variant="primary" disabled={running} aria-busy={running} className="min-w-40">
              {running ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-bg/30 border-t-bg"
                  />
                  Analysing…
                </>
              ) : (
                "Run analysis"
              )}
            </Button>
            {running && (
              <Button type="button" variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            )}
            <span className="text-xs text-ink-3">
              {mode === "sample" ? "Uses the synthetic sample." : file ? `Will upload ${file.name}.` : "No file chosen yet."}
            </span>
          </div>
        </Panel>
      </form>

      <div className="mt-4 space-y-3" aria-live="polite">
        {apiError && (
          <div id="analyse-error">
            <Banner tone="error" title="Analysis failed">
              {apiError.message}
              {apiError.requestId && (
                <span className="mt-1 block font-mono text-xs text-ink-3">Request ID {apiError.requestId}</span>
              )}
            </Banner>
          </div>
        )}
      </div>

      <div ref={resultsRef} className="scroll-mt-20">
        <AnimatePresence mode="wait">
          {running && !result ? (
            <m.div key="skel" exit={{ opacity: 0 }} className="mt-6">
              <ResultsSkeleton />
            </m.div>
          ) : result ? (
            <m.div
              key={`${result.signal.name}-${result.params.load_pct}-${result.prediction.severity}-${result.features.lsb_db}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: running ? 0.5 : 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-6"
              aria-busy={running}
            >
              <Suspense fallback={<ResultsSkeleton />}>
                <Results result={result} />
              </Suspense>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading results">
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <PanelSkeleton height={240} />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
      <PanelSkeleton height={300} />
      <div className="grid gap-4 xl:grid-cols-2">
        <PanelSkeleton height={260} />
        <PanelSkeleton height={260} />
      </div>
    </div>
  );
}
