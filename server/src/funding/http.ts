// server/src/funding/http.ts

import axios from "axios";

export function safeFloat(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function isoFromMs(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function httpGet<T = any>(
  url: string,
  params?: Record<string, any>,
  headers?: Record<string, string>,
  timeoutMs: number = 15000
): Promise<T> {
  const res = await axios.get(url, {
    params: params ?? {},
    headers: headers ?? {},
    timeout: timeoutMs,
  });
  return res.data as T;
}
