import { m } from "framer-motion";
import { IconAlert, IconCheck, IconX } from "../components/Icons";
import { C, SEVERITY_COLORS, SEVERITY_SHORT } from "../theme";
import type { Prediction } from "../types";

export function HealthGauge({
  prediction,
  groundTruth,
  reducedConfidence,
}: {
  prediction: Prediction;
  groundTruth: { severity: number; label: string } | null;
  reducedConfidence: boolean;
}) {
  const sev = prediction.severity;
  const top = prediction.probabilities[sev]?.p ?? 0;
  const healthy = sev === 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
          style={{ background: `${SEVERITY_COLORS[sev]}22`, color: SEVERITY_COLORS[sev] }}
        >
          {healthy ? <IconCheck /> : <IconAlert />}
        </span>
        <div className="min-w-0">
          <p className="eyebrow">Predicted severity</p>
          <p className="display mt-1 text-[34px] text-ink sm:text-[40px]">{prediction.label}</p>
        </div>
        <p className="ml-auto font-mono text-sm text-ink-2">
          p = <span className="text-ink">{(top * 100).toFixed(1)}%</span>
        </p>
      </div>

      {/* Segmented gauge */}
      <div className="relative mt-6" role="img" aria-label={`Severity gauge: ${prediction.label} of five classes`}>
        <div className="flex gap-0.5">
          {SEVERITY_SHORT.map((label, i) => (
            <div
              key={label}
              className="h-2.5 flex-1 first:rounded-l-full last:rounded-r-full"
              style={{ background: SEVERITY_COLORS[i], opacity: i === sev ? 1 : 0.22 }}
            />
          ))}
        </div>
        <m.div
          aria-hidden="true"
          className="absolute -top-2.5 h-0 w-0"
          initial={false}
          animate={{ left: `${(sev + 0.5) * 20}%` }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          style={{
            translateX: "-50%",
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: `7px solid ${C.ink}`,
          }}
        />
        <div className="mt-2 flex">
          {SEVERITY_SHORT.map((label, i) => (
            <span
              key={label}
              className={`flex-1 text-center text-[11px] ${i === sev ? "font-semibold text-ink" : "text-ink-3"}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Class probabilities */}
      <dl className="mt-6 space-y-2.5">
        {prediction.probabilities.map((p) => (
          <div key={p.severity} className="grid grid-cols-[7.5rem_1fr_3.75rem] items-center gap-3 text-sm">
            <dt className={p.severity === sev ? "text-ink" : "text-ink-2"}>{p.label}</dt>
            <div className="h-2 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
              <m.div
                className="h-full rounded-full"
                style={{ background: SEVERITY_COLORS[p.severity] }}
                initial={{ width: 0 }}
                animate={{ width: `${p.p * 100}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
            <dd className="text-right font-mono text-[13px] text-ink">{(p.p * 100).toFixed(1)}%</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 space-y-2 text-[13px] leading-relaxed">
        {reducedConfidence && (
          <p className="flex items-start gap-2 text-ink-2">
            <IconAlert className="mt-0.5 shrink-0 text-amber" width={16} height={16} />
            Light load: treat this estimate with caution (see the warning above).
          </p>
        )}
        {groundTruth && (
          <p className="flex items-start gap-2 text-ink-2">
            {groundTruth.severity === sev ? (
              <IconCheck className="mt-0.5 shrink-0 text-signal" width={16} height={16} />
            ) : (
              <IconX className="mt-0.5 shrink-0 text-amber" width={16} height={16} />
            )}
            <span>
              The sample was simulated with <span className="text-ink">{groundTruth.label.toLowerCase()}</span>
              {groundTruth.severity === sev ? ", so the prediction matches." : ", so the prediction is wrong for this one."}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
