export type DataSource = "real" | "synthetic";

export interface Citation {
  authors: string;
  title: string;
  publisher: string;
  year: number;
  doi: string;
  url: string;
}

export interface Status {
  ready: boolean;
  data_source: DataSource | null;
  features_file?: string;
  n_recordings?: number;
  loads_pct?: number[];
  class_counts?: Record<string, number>;
  model?: ModelInfo;
  computed_at?: string;
  citation: Citation;
  limits: {
    max_upload_mb: number;
    fs_min: number;
    fs_max: number;
    f_supply_min: number;
    f_supply_max: number;
    load_min: number;
    load_max: number;
    min_duration_s: number;
    light_load_pct: number;
  };
  sample: { fs: number; duration_s: number; f_supply: number; synthetic: boolean };
}

export interface ModelInfo {
  type: string;
  n_estimators: number;
  min_samples_leaf: number;
  class_weight: string;
  inputs: string[];
}

export interface DetectionPoint {
  load_pct: number;
  n: number;
  lsb_mean: number;
  lsb_std: number;
  usb_mean: number;
  usb_std: number;
}

export interface DetectionLimit {
  data_source: DataSource;
  computed_at: string;
  n_recordings: number;
  loads: number[];
  light_load_pct: number;
  series: { severity: number; label: string; points: DetectionPoint[] }[];
}

export interface Validation {
  data_source: DataSource;
  computed_at: string;
  n_recordings: number;
  model: ModelInfo;
  per_load: { load_pct: number; n_test: number; n_correct: number; accuracy: number }[];
  mean_accuracy: number;
  overall_accuracy: number;
  baseline_accuracy: number;
  confusion: { labels: string[]; counts: number[][] };
}

export interface Warning {
  code: string;
  message: string;
}

export interface Prediction {
  severity: number;
  label: string;
  probabilities: { severity: number; label: string; p: number }[];
}

export interface AnalysisResult {
  signal: {
    source: "upload" | "sample";
    synthetic: boolean;
    name: string;
    ground_truth: { severity: number; label: string } | null;
    fs: number;
    n_samples: number;
    duration_s: number;
    columns: string[];
    format: string;
  };
  params: {
    f_supply: number;
    load_pct: number;
    slip_predicted: number | null;
    slip_estimated: number | null;
    fs_analysis: number | null;
  };
  features: { lsb_db: number | null; usb_db: number | null; epva_db: number | null; stft_ratio_db: number | null };
  markers: {
    f1: number | null;
    f_lsb: number | null;
    f_usb: number | null;
    f_2sf: number | null;
    two_sf_predicted: number | null;
  };
  spectrum: { f: number[]; db: number[]; f_lo: number; f_hi: number };
  park: { f: number[]; db: number[]; f_lo: number; f_hi: number };
  stft: {
    t: number[];
    f: number[];
    db: number[][];
    bands: { label: string; f_lo: number; f_hi: number }[];
    window_s: number;
  };
  prediction: Prediction;
  model: { data_source: DataSource; n_recordings: number };
  warnings: Warning[];
}
