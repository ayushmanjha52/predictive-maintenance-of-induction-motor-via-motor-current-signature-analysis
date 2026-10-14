import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { PageHeader, Panel, SyntheticBadge } from "../components/ui";
import { usePageMeta } from "../hooks";
import { useStatus } from "../status";

// Nameplate of the dataset motor: 4 poles, 60 Hz, 1715 rpm at rated load.
const F = 60;
const SYNC_RPM = 1800;
const RATED_RPM = 1715;
const RATED_SLIP = (SYNC_RPM - RATED_RPM) / SYNC_RPM;

const CITATION = {
  authors: "A. E. Treml, R. A. Flauzino, M. Suetake, N. A. R. Maciejewski",
  title: "Experimental database for detecting and diagnosing rotor broken bar in a three-phase induction motor",
  publisher: "IEEE Dataport",
  year: 2020,
  doi: "10.21227/fmnm-bn95",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Panel as="section" labelledBy={`${id}-h`} title={title}>
      <div id={id} className="max-w-3xl scroll-mt-28 space-y-3 text-[15px] leading-relaxed text-ink-2 [&_strong]:font-medium [&_strong]:text-ink">
        {children}
      </div>
    </Panel>
  );
}

function SidebandCalculator() {
  const [load, setLoad] = useState(75);
  const s = RATED_SLIP * (load / 100);
  const rows = [
    ["Slip s", `${(s * 100).toFixed(2)}%`],
    ["(1 − 2s)f", `${((1 - 2 * s) * F).toFixed(2)} Hz`],
    ["(1 + 2s)f", `${((1 + 2 * s) * F).toFixed(2)} Hz`],
    ["Distance from f", `${(2 * s * F).toFixed(2)} Hz`],
  ];
  return (
    <div className="rounded-lg border border-line bg-bg p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor="calc-load" className="text-sm text-ink-2">
          Load
        </label>
        <output htmlFor="calc-load" className="font-mono text-sm text-ink">
          {load.toFixed(1)}%
        </output>
      </div>
      <input
        id="calc-load"
        type="range"
        min={12.5}
        max={100}
        step={12.5}
        value={load}
        onChange={(e) => setLoad(Number(e.target.value))}
        className="w-full"
        style={{ ["--fill" as string]: `${((load - 12.5) / 87.5) * 100}%` }}
      />
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink-3">{k}</dt>
            <dd className="font-mono text-sm text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-3">
        From the motor nameplate (1715 rpm at full load, 1800 rpm synchronous), with slip assumed proportional to load.
      </p>
    </div>
  );
}

export default function AboutPage() {
  usePageMeta(
    "About and method",
    "How motor current signature analysis detects broken rotor bars: the (1±2s)f sidebands, the Extended Park's Vector, STFT, why light load is hard, and the dataset used.",
  );
  const { status } = useStatus();
  const { hash } = useLocation();
  const synthetic = status?.data_source === "synthetic";

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  const lightSlip = RATED_SLIP * 0.125;

  return (
    <div>
      <PageHeader
        eyebrow="04 — About & method"
        title={<>Hearing a rotor fault <em>through the wires</em></>}
        lead="MotorScope is a teaching demo of motor current signature analysis (MCSA): finding a mechanical rotor fault by listening to the electrical current, without touching the motor."
      />
      <div className="space-y-4">
        <Section id="sidebands" title="The (1 ± 2s)f sidebands">
          <p>
            An induction motor's rotor turns slightly slower than the rotating magnetic field. That shortfall is the{" "}
            <strong>slip, s</strong>. It is zero with no load and a few percent at full load.
          </p>
          <p>
            A rotor bar that has cracked stops carrying current, so the rotor's own magnetic field becomes lopsided.
            That lopsided field induces two extra components in the stator current, just below and just above the
            supply frequency f: <strong>(1 − 2s)f</strong> and <strong>(1 + 2s)f</strong>. The more bars are broken,
            the taller these sidebands get relative to the fundamental. MCSA measures their height in decibels.
          </p>
          <SidebandCalculator />
        </Section>

        <Section id="park" title="Park's vector (EPVA)">
          <p>
            The three phase currents can be combined into a single rotating arrow, the <strong>Park's vector</strong>.
            In a healthy, balanced motor its length stays almost constant. A broken bar makes the length pulse at{" "}
            <strong>2sf</strong>, the gap between the two sidebands.
          </p>
          <p>
            The Extended Park's Vector Approach looks for that 2sf ripple in the spectrum of the arrow's length. It uses
            all three phases at once and turns the sideband pair into one low-frequency line, which is easier to pick
            out. It also ignores slow drift in the supply frequency, because that changes the arrow's speed, not its
            length.
          </p>
        </Section>

        <Section id="stft" title="Short-time Fourier transform">
          <p>
            A single long spectrum assumes the motor ran steadily for the whole recording. The STFT cuts the recording
            into overlapping windows and takes a spectrum of each one, so you can see whether the sideband energy is
            steady (a real fault) or comes and goes (a load disturbance).
          </p>
          <p>
            MotorScope reports the average energy inside the two sideband bands relative to the energy at the
            fundamental. The window is chosen long enough to separate the sidebands from the fundamental at the
            selected load. That is why the heatmap gets blocky at light load.
          </p>
        </Section>

        <Section id="light-load" title="Why light load is hard">
          <p>
            Both effects work against you as load drops. At 12.5% load the slip is about{" "}
            <strong>{(lightSlip * 100).toFixed(2)}%</strong>, so the sidebands sit only{" "}
            <strong>{(2 * lightSlip * F).toFixed(2)} Hz</strong> from a fundamental that is tens of decibels
            stronger. Any spreading of the fundamental from window leakage, supply-frequency drift or load wobble can
            bury them.
          </p>
          <p>
            Second, little current flows in the rotor at light load, so a broken bar disturbs the field less and the
            sidebands themselves are smaller. Separating them needs long recordings and a spectral window with very low
            leakage. Even then, a healthy rotor and one broken bar can look alike. The{" "}
            <Link to="/detection-limit" className="text-signal underline underline-offset-2">
              detection-limit chart
            </Link>{" "}
            and the per-load{" "}
            <Link to="/validation" className="text-signal underline underline-offset-2">
              validation results
            </Link>{" "}
            show this directly.
          </p>
        </Section>

        <Section id="data" title="Dataset">
          <p className="rounded-lg border border-line bg-bg px-4 py-3 font-medium text-ink">
            Public dataset; the test bench was not built by the author.
          </p>
          <p>
            MotorScope is designed around the open-access experimental database by Treml et al. A 1 hp, 4-pole, 60 Hz
            induction motor with a 34-bar rotor was tested with a healthy rotor and with 1 to 4 broken bars, at 8 load
            levels from 12.5% to 100%, with ten repetitions of each condition.
          </p>
          <p className="rounded-lg border border-line bg-bg px-4 py-3 text-sm">
            {CITATION.authors}, “{CITATION.title},” {CITATION.publisher}, {CITATION.year}. doi:{" "}
            <a
              href={`https://doi.org/${CITATION.doi}`}
              className="text-signal underline underline-offset-2"
              rel="noopener noreferrer"
              target="_blank"
            >
              {CITATION.doi}
            </a>
            <span className="sr-only"> (opens in a new tab)</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-ink">Data on this server:</span>
            {status?.data_source == null ? (
              <span className="text-ink-3">unknown (server unreachable)</span>
            ) : synthetic ? (
              <SyntheticBadge />
            ) : (
              <span className="font-mono text-sm text-signal">real dataset ({status.features_file})</span>
            )}
          </div>
          {synthetic && (
            <>
              <p>
                Downloading the dataset needs an IEEE DataPort login, and it isn't bundled with this app. Until it's loaded,
                the server uses a <strong>physics-based simulator</strong> instead: sidebands that scale with the
                number of broken bars and with load, plus supply-frequency drift, load oscillation, harmonics and noise.
                Every chart and number derived from it is marked <span className="font-mono text-amber">SYNTHETIC DEMO DATA</span>.
              </p>
              <p>To switch to the real data:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Download the dataset from IEEE DataPort (DOI above).</li>
                <li>
                  List each recording in a <span className="font-mono text-ink">manifest.csv</span> with its severity,
                  load and sampling rate.
                </li>
                <li>
                  Run <span className="font-mono text-ink">python build_features.py --manifest manifest.csv</span> in{" "}
                  <span className="font-mono text-ink">backend/</span>, then restart the server.
                </li>
              </ol>
            </>
          )}
        </Section>

        <Section id="limitations" title="Limitations">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Slip is estimated from the load you enter and the dataset motor's nameplate, then refined from the
              spectrum. A different motor or an incorrect load moves the expected sideband positions.
            </li>
            <li>
              The classifier learns from one motor. Sideband levels depend on the machine, so its probabilities don't
              transfer to other motors without retraining.
            </li>
            <li>Other faults and conditions (eccentricity, load oscillation, poor supply) can create similar sidebands.</li>
            <li>This is an educational demo, not a monitoring product. Don't use it for safety or maintenance decisions.</li>
          </ul>
        </Section>

        <Section id="credits" title="Software and licences">
          <p>
            Fonts: <strong>Instrument Serif</strong> and <strong>Instrument Sans</strong> (Instrument) and{" "}
            <strong>IBM Plex Mono</strong> (IBM), all under the SIL Open Font License 1.1, served from this site. No
            external font or analytics services are used.
          </p>
          <p>
            Libraries: React, React Router, Recharts, Framer Motion, Tailwind CSS (MIT); FastAPI, Uvicorn (BSD/MIT);
            NumPy, SciPy, pandas, scikit-learn (BSD-3-Clause). The logo and icons were drawn for this project.
          </p>
        </Section>
      </div>
    </div>
  );
}
