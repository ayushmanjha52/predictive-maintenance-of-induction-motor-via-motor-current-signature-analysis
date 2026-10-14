import { m } from "framer-motion";

export function FeatureCard({
  label,
  value,
  detail,
  hint,
}: {
  label: string;
  value: string;
  detail?: string;
  hint: string;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="surface min-w-0 rounded-panel p-5"
    >
      {/* not uppercased: the labels carry notation like (1−2s)f */}
      <p className="font-mono text-xs tracking-[0.04em] text-ink-3">{label}</p>
      <p className="mt-3 font-mono text-[26px] font-medium tracking-[-0.02em] text-ink">{value}</p>
      {detail && <p className="mt-0.5 font-mono text-xs text-ink-3">{detail}</p>}
      <p className="mt-3 text-xs leading-relaxed text-ink-3">{hint}</p>
    </m.div>
  );
}
