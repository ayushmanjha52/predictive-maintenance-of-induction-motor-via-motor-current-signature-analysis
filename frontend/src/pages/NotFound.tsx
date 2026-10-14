import { Link, useLocation } from "react-router-dom";
import { Logo } from "../components/Icons";
import { usePageMeta } from "../hooks";

export default function NotFoundPage() {
  usePageMeta("Page not found", "This page doesn't exist on MotorScope.", true);
  const { pathname } = useLocation();
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <div className="mx-auto mb-6 w-fit">
        <Logo size={48} />
      </div>
      <p className="eyebrow">Error 404</p>
      <h1 className="display mt-3 text-[44px] text-ink">
        No signal <em className="text-signal">at this address</em>
      </h1>
      <p className="mt-3 wrap-break-word text-ink-2">
        Nothing lives at <span className="font-mono text-ink">{pathname}</span>. It may have moved, or the link may be
        mistyped.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          to="/"
          className="inline-flex min-h-10 items-center rounded-lg bg-signal px-4 text-sm font-semibold text-bg hover:bg-signal-bright"
        >
          Analyse a recording
        </Link>
        <Link
          to="/about"
          className="inline-flex min-h-10 items-center rounded-lg border border-line-strong px-4 text-sm text-ink hover:border-ink-3"
        >
          How it works
        </Link>
      </div>
    </div>
  );
}
