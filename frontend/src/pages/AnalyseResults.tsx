import { HealthGauge } from "../charts/HealthGauge";
import { SpectrumChart, type Marker } from "../charts/SpectrumChart";
import { StftHeatmap } from "../charts/StftHeatmap";
import { FeatureCard } from "../components/FeatureCard";
import { Banner, Panel, SyntheticBadge } from "../components/ui";
import { fmt } from "../theme";
import type { AnalysisResult } from "../types";

const LIGHT_LOAD_MESSAGE = "Sidebands sit within 1 Hz of the fundamental; detection confidence is reduced.";

/** Result panels. Lazy-loaded with the chart library, so the first page view stays light. */
export default function Results({ result }: { result: AnalysisResult }) {
  const { signal, params, features, markers, prediction, warnings } = result;
  const syntheticSignal = signal.synthetic;
  const syntheticModel = result.model.data_source === "synthetic";
  const badge = syntheticSignal ? <SyntheticBadge /> : null;
  const lightLoad = warnings.some((w) => w.code === "light_load");
  const f1 = markers.f1 ?? params.f_supply;

  const specMarkers: Marker[] = [
    { x: f1, label: `f ${f1.toFixed(2)}`, anchor: "middle", row: 0, emphasis: true },
    ...(markers.f_lsb != null ? [{ x: markers.f_lsb, label: "(1−2s)f", anchor: "end" as const, row: 1 as const }] : []),
    ...(markers.f_usb != null ? [{ x: markers.f_usb, label: "(1+2s)f", anchor: "start" as const, row: 1 as const }] : []),
  ];
  const specPeaks = [
    ...(markers.f_lsb != null && features.lsb_db != null ? [{ x: markers.f_lsb, y: features.lsb_db }] : []),
    ...(markers.f_usb != null && features.usb_db != null ? [{ x: markers.f_usb, y: features.usb_db }] : []),
  ];
  const parkMarkers: Marker[] =
    markers.f_2sf != null ? [{ x: markers.f_2sf, label: `2sf ${markers.f_2sf.toFixed(2)} Hz`, anchor: "start", row: 0, emphasis: true }] : [];
  const parkPeaks = markers.f_2sf != null && features.epva_db != null ? [{ x: markers.f_2sf, y: features.epva_db }] : [];

  return (
    <div className="space-y-4">
      <Banner tone="success" live title="Analysis complete">
        {signal.name} · {signal.duration_s.toFixed(1)} s at {fmt.num(signal.fs)} Hz · {params.load_pct}% load
        {params.slip_estimated != null && ` · estimated slip ${(params.slip_estimated * 100).toFixed(2)}%`}
      </Banner>

      {warnings.map((w) => (
        <Banner key={w.code} tone="warning" title={w.code === "light_load" ? "Light load" : "Check the input"}>
          {w.code === "light_load" ? LIGHT_LOAD_MESSAGE : w.message}
        </Banner>
      ))}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel
          title="Severity estimate"
          subtitle={`RandomForest trained on ${fmt.num(result.model.n_recordings)} ${
            syntheticModel ? "synthetic" : "real"
          } recordings`}
          actions={syntheticModel || syntheticSignal ? <SyntheticBadge /> : null}
        >
          <HealthGauge prediction={prediction} groundTruth={signal.ground_truth} reducedConfidence={lightLoad} />
        </Panel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FeatureCard
            label="Lower sideband (1−2s)f"
            value={fmt.db(features.lsb_db)}
            detail={markers.f_lsb != null ? `at ${fmt.hz(markers.f_lsb)}` : undefined}
            hint="Level of the lower sideband relative to the fundamental. It grows with each broken bar."
          />
          <FeatureCard
            label="Upper sideband (1+2s)f"
            value={fmt.db(features.usb_db)}
            detail={markers.f_usb != null ? `at ${fmt.hz(markers.f_usb)}` : undefined}
            hint="Usually smaller than the lower one; speed ripple from the fault feeds it."
          />
          <FeatureCard
            label="EPVA (2sf)"
            value={fmt.db(features.epva_db)}
            detail={markers.f_2sf != null ? `at ${fmt.hz(markers.f_2sf)}` : undefined}
            hint="The 2sf ripple in the Park's-vector modulus, relative to its mean. It uses all three phases."
          />
          <FeatureCard
            label="STFT sideband ratio"
            value={fmt.db(features.stft_ratio_db)}
            detail={`window ${result.stft.window_s.toFixed(2)} s`}
            hint="Energy in the two sideband bands over energy at the fundamental, averaged over time."
          />
        </div>
      </div>

      <Panel
        title="Current spectrum"
        subtitle={`Phase A, ${result.spectrum.f_lo}–${result.spectrum.f_hi} Hz, dB relative to the fundamental`}
        actions={badge}
      >
        <SpectrumChart
          f={result.spectrum.f}
          db={result.spectrum.db}
          xDomain={[result.spectrum.f_lo, result.spectrum.f_hi]}
          markers={specMarkers}
          peaks={specPeaks}
          height={320}
          yLabel="dB"
          ariaLabel={`Current spectrum around the ${f1.toFixed(2)} Hz fundamental. Lower sideband ${fmt.db(
            features.lsb_db,
          )} at ${fmt.hz(markers.f_lsb)}, upper sideband ${fmt.db(features.usb_db)} at ${fmt.hz(markers.f_usb)}.`}
        />
        <p className="mt-3 font-mono text-xs leading-relaxed text-ink-3">
          f₁ {fmt.hz(markers.f1)} · (1−2s)f {fmt.hz(markers.f_lsb)} → {fmt.db(features.lsb_db)} · (1+2s)f{" "}
          {fmt.hz(markers.f_usb)} → {fmt.db(features.usb_db)}
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Park's-vector spectrum"
          subtitle="Modulus of the current Park's vector, dB relative to its mean"
          actions={badge}
        >
          <SpectrumChart
            f={result.park.f}
            db={result.park.db}
            xDomain={[0, result.park.f_hi]}
            markers={parkMarkers}
            peaks={parkPeaks}
            height={280}
            yLabel="dB"
            xTickStep={result.park.f_hi > 12 ? 5 : 2}
            ariaLabel={`Park's vector modulus spectrum. The 2sf component is ${fmt.db(features.epva_db)} at ${fmt.hz(
              markers.f_2sf,
            )}.`}
          />
          <p className="mt-3 font-mono text-xs text-ink-3">
            2sf {fmt.hz(markers.f_2sf)} → {fmt.db(features.epva_db)} (predicted {fmt.hz(markers.two_sf_predicted)})
          </p>
        </Panel>
        <Panel
          title="STFT"
          subtitle={`Phase A over time; boxes mark the sideband bands (${result.stft.window_s.toFixed(2)} s window)`}
          actions={badge}
        >
          <StftHeatmap stft={result.stft} height={280} />
          <p className="mt-3 font-mono text-xs text-ink-3">
            Sideband-to-fundamental energy ratio {fmt.db(features.stft_ratio_db)}
          </p>
        </Panel>
      </div>
    </div>
  );
}
