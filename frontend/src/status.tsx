import { createContext, useContext, useState, type ReactNode } from "react";
import { useApi, type ApiError } from "./api";
import type { AnalysisResult, Status } from "./types";

interface StatusCtx {
  status?: Status;
  loading: boolean;
  error?: ApiError;
  retry: () => void;
}

const Ctx = createContext<StatusCtx>({ loading: true, retry: () => {} });

export function StatusProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, retry } = useApi<Status>("/status");
  return <Ctx.Provider value={{ status: data, loading, error, retry }}>{children}</Ctx.Provider>;
}

export const useStatus = () => useContext(Ctx);

/** Analysis form + last result, kept while the user moves between pages. */
export interface AnalysisState {
  mode: "sample" | "upload";
  sampleSeverity: number;
  loadPct: number;
  fs: string;
  fSupply: string;
  file: File | null;
  result: AnalysisResult | null;
}

const AnalysisCtx = createContext<[AnalysisState, (s: Partial<AnalysisState>) => void] | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnalysisState>({
    mode: "sample",
    sampleSeverity: 2,
    loadPct: 75,
    fs: "",
    fSupply: "60",
    file: null,
    result: null,
  });
  const update = (s: Partial<AnalysisState>) => setState((prev) => ({ ...prev, ...s }));
  return <AnalysisCtx.Provider value={[state, update]}>{children}</AnalysisCtx.Provider>;
}

export function useAnalysisState() {
  const ctx = useContext(AnalysisCtx);
  if (!ctx) throw new Error("useAnalysisState outside AnalysisProvider");
  return ctx;
}
