import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconAlert, IconCheck, IconX } from "./Icons";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  as: Tag = "section",
  labelledBy,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  labelledBy?: string;
}) {
  return (
    <Tag className={`surface min-w-0 rounded-panel p-4 sm:p-6 ${className}`} aria-labelledby={labelledBy}>
      {(title || actions) && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && (
              <h2 id={labelledBy} className="text-base font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

/** Shown on every chart or metric that is derived from simulated signals. */
export function SyntheticBadge({ label = "SYNTHETIC DEMO DATA" }: { label?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-amber/40 bg-amber-deep px-2.5 py-1 font-mono text-[10.5px] font-medium tracking-[0.12em] text-amber"
      title="Computed from simulated signals, not measurements from a real motor"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_6px_1px_rgb(255_182_92/0.7)]" />
      {label}
    </span>
  );
}

type BannerTone = "warning" | "error" | "success" | "info";

export function Banner({
  tone,
  title,
  children,
  action,
  live = false,
}: {
  tone: BannerTone;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  live?: boolean;
}) {
  const styles: Record<BannerTone, string> = {
    warning: "border-amber/45 bg-amber-deep/70",
    error: "border-amber/70 bg-amber-deep",
    success: "border-signal/40 bg-signal-deep/40",
    info: "border-line bg-panel-2",
  };
  const icon =
    tone === "success" ? (
      <IconCheck className="text-signal" />
    ) : tone === "error" ? (
      <IconX className="text-amber" />
    ) : tone === "warning" ? (
      <IconAlert className="text-amber" />
    ) : (
      <IconAlert className="text-ink-2" />
    );
  return (
    <div
      role={tone === "error" ? "alert" : live ? "status" : undefined}
      className={`flex items-start gap-3 rounded-panel border px-4 py-3 text-sm ${styles[tone]}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 leading-relaxed text-ink">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "text-ink-2" : ""}>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function PanelSkeleton({ height = 260, title = true }: { height?: number; title?: boolean }) {
  return (
    <div className="surface rounded-panel p-6" aria-hidden="true">
      {title && <Skeleton className="mb-2 h-4 w-40" />}
      {title && <Skeleton className="mb-5 h-3 w-64 max-w-full" />}
      <div className="skeleton w-full" style={{ height }} />
    </div>
  );
}

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const v = {
    primary:
      "bg-signal text-bg font-semibold shadow-[0_0_0_1px_rgb(142_240_184/0.35),0_10px_30px_-10px_rgb(142_240_184/0.55)] hover:bg-signal-bright disabled:bg-line-strong disabled:text-ink-2 disabled:shadow-none disabled:cursor-not-allowed",
    secondary:
      "border border-line-strong bg-panel-2 text-ink hover:border-ink-3 hover:bg-panel-3 disabled:opacity-60",
    ghost: "text-ink-2 hover:text-ink hover:bg-panel-2",
  }[variant];
  return (
    <button
      {...rest}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm transition-colors ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function ViewToggle({
  view,
  onChange,
  label,
}: {
  view: "chart" | "table";
  onChange: (v: "chart" | "table") => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={`${label}: view as`} className="inline-flex rounded-lg border border-line p-0.5">
      {(["chart", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
            view === v ? "bg-panel-2 text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/** Page heading: a mono eyebrow naming the page, then a serif headline. Wrap a word in <em> for the italic accent. */
export function PageHeader({ eyebrow, title, lead }: { eyebrow: string; title: ReactNode; lead?: ReactNode }) {
  return (
    <header className="mb-8 sm:mb-10">
      <p className="eyebrow flex items-center gap-3">
        <span aria-hidden="true" className="h-px w-8 bg-signal/70" />
        {eyebrow}
      </p>
      <h1 className="display mt-4 text-[40px] text-ink sm:text-[56px] [&_em]:text-signal [&_em]:italic">{title}</h1>
      {lead && <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-2">{lead}</p>}
    </header>
  );
}
