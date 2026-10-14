import { useCallback, useEffect, useState } from "react";
import type { AnalysisResult } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "/api";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public requestId: string | null = null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000, outer?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  const relay = () => ctrl.abort("cancelled");
  outer?.addEventListener("abort", relay);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
  } catch {
    if (ctrl.signal.reason === "timeout") {
      throw new ApiError("timeout", "The server took too long to respond. Try a shorter recording or try again.");
    }
    if (ctrl.signal.reason === "cancelled") throw new ApiError("cancelled", "Request cancelled.");
    throw new ApiError("network", "Can't reach the analysis server. Check that the backend is running, then retry.");
  } finally {
    window.clearTimeout(timer);
    outer?.removeEventListener("abort", relay);
  }
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; request_id?: string } } | null = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(
      body?.error?.code ?? `http_${res.status}`,
      body?.error?.message ?? `The server returned an error (${res.status}).`,
      res.status,
      body?.error?.request_id ?? res.headers.get("X-Request-ID"),
    );
  }
  return (await res.json()) as T;
}

export interface AnalyseParams {
  loadPct: number;
  fSupply: number;
  fs: number;
}

export function analyseFile(file: File, p: AnalyseParams, signal?: AbortSignal) {
  const qs = new URLSearchParams({ load_pct: String(p.loadPct), f_supply: String(p.fSupply), fs: String(p.fs) });
  return request<AnalysisResult>(
    `/analyse?${qs}`,
    {
      method: "POST",
      body: file,
      // The name travels in a header so it never appears in server access logs.
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name.slice(0, 255)) },
    },
    180_000,
    signal,
  );
}

export function analyseSample(severity: number, loadPct: number, signal?: AbortSignal) {
  const qs = new URLSearchParams({ sample: "true", sample_severity: String(severity), load_pct: String(loadPct) });
  return request<AnalysisResult>(`/analyse?${qs}`, { method: "POST" }, 60_000, signal);
}

const cache = new Map<string, unknown>();

/** GET with a per-session cache, so switching pages doesn't refetch startup statistics. */
export function useApi<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>(() =>
    cache.has(path) ? { data: cache.get(path) as T, loading: false } : { loading: true },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cache.has(path)) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    request<T>(path, {}, 30_000, ctrl.signal)
      .then((data) => {
        cache.set(path, data);
        setState({ data, loading: false });
      })
      .catch((err: ApiError) => {
        if (err.code !== "cancelled") setState({ error: err, loading: false });
      });
    return () => ctrl.abort();
  }, [path, attempt]);

  const retry = useCallback(() => {
    cache.delete(path);
    setAttempt((n) => n + 1);
  }, [path]);

  return { ...state, retry };
}
