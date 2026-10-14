import { useEffect, useRef, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useStatus } from "../status";
import { IconGrid, IconInfo, IconTrend, IconWave, Logo } from "./Icons";
import { Banner, Button, SyntheticBadge } from "./ui";

const NAV = [
  { to: "/", label: "Analyse", short: "Analyse", Icon: IconWave },
  { to: "/detection-limit", label: "Detection limit", short: "Limit", Icon: IconTrend },
  { to: "/validation", label: "Model validation", short: "Validation", Icon: IconGrid },
  { to: "/about", label: "About / Method", short: "About", Icon: IconInfo },
];

function DataChip() {
  const { status } = useStatus();
  if (!status?.data_source) return null;
  return status.data_source === "synthetic" ? (
    <SyntheticBadge />
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/40 px-2.5 py-1 font-mono text-[10.5px] tracking-wider text-signal">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />
      REAL DATASET
    </span>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md" aria-label="MotorScope home">
      <Logo size={compact ? 28 : 32} />
      <span className="text-[17px] leading-none text-ink">
        <span className="font-semibold tracking-[-0.02em]">Motor</span>
        <span className="font-serif text-[20px] italic">Scope</span>
      </span>
    </Link>
  );
}

function DataSourceBanner() {
  const { status, error, loading, retry } = useStatus();
  if (loading) return null;
  if (error) {
    return (
      <Banner
        tone="error"
        title="Can't reach the analysis server"
        action={
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        }
      >
        {error.message}
      </Banner>
    );
  }
  if (status && !status.ready) {
    return (
      <Banner tone="error" title="The model isn't available">
        The features file is missing or invalid, so nothing can be computed yet. See the README for how to build
        it.
      </Banner>
    );
  }
  if (status?.data_source === "synthetic") {
    return (
      <Banner tone="warning" title="Running on synthetic demo data">
        The real dataset isn't loaded on this server, so every chart and metric is computed from simulated
        signals and says nothing about real motors.{" "}
        <Link to="/about#data" className="font-medium text-amber underline underline-offset-2">
          How to load the real data
        </Link>
      </Banner>
    );
  }
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);

  // On client-side navigation (not first load), start at the top and move focus to the new page.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (hash) return;
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, hash]);

  const year = new Date().getFullYear();

  return (
    <div className="min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-signal px-3 py-2 font-medium text-bg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-sunken/90 px-4 py-6 backdrop-blur md:flex">
        <div className="px-2">
          <Brand />
        </div>
        <p className="eyebrow mt-10 mb-3 px-3">Sections</p>
        <nav aria-label="Main">
          <ul className="space-y-0.5">
            {NAV.map(({ to, label, Icon }, i) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-panel-2 text-ink before:absolute before:inset-y-2 before:-left-4 before:w-0.5 before:rounded-full before:bg-signal before:shadow-[0_0_8px_rgb(142_240_184/0.8)]"
                        : "text-ink-2 hover:bg-panel hover:text-ink"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={isActive ? "text-signal" : "text-ink-3"} />
                      <span className="flex-1">{label}</span>
                      <span className="font-mono text-[10px] text-ink-3">0{i + 1}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto space-y-3 border-t border-line px-2 pt-5">
          <DataChip />
          <p className="text-xs leading-relaxed text-ink-3">
            A teaching instrument for motor current signature analysis.
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur md:hidden">
        <Brand compact />
        <DataChip />
      </header>

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="px-4 pb-28 pt-5 outline-none sm:px-6 md:ml-60 md:pb-10 md:pt-8 lg:px-10"
      >
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-6 empty:hidden">
            <DataSourceBanner />
          </div>
          {children}
          <footer className="mt-14 flex flex-col gap-3 border-t border-line pt-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
            <p>© {year} MotorScope. Public dataset; the test bench was not built by the author.</p>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
              <Link to="/about" className="hover:text-ink">
                About / Method
              </Link>
              <Link to="/privacy" className="hover:text-ink">
                Privacy &amp; terms
              </Link>
            </nav>
          </footer>
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-sunken/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-4">
          {NAV.map(({ to, short, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] ${
                    isActive ? "text-ink" : "text-ink-2"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={isActive ? "text-signal" : "text-ink-3"} />
                    {short}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
