import { useEffect, useState } from "react";
import bins from "../../../data/bins.json";

export type Status = "open" | "assigned" | "done";
export type Kind = "full" | "dirty" | "missing";
export type Source = "sensor" | "citizen";

export interface Case {
  id: number;
  bin_id: number;
  status: Status;
  team: string | null;
  opened_at: string;
  assigned_at: string | null;
  done_at: string | null;
  sensor_reports: number;
  citizen_reports: number;
  kinds: string;
}

export const BINS = bins.features;
export const binById = (id: number) => BINS[id - 1];

export const STATUS_LABEL: Record<Status, string> = { open: "待處理", assigned: "已指派", done: "已完成" };
export const KIND_LABEL: Record<Kind, string> = { full: "滿了", dirty: "髒亂", missing: "沒有桶" };

// 帶 HTTP 狀態碼，呼叫端才分得出 404（不會再出現）和斷線（等一下就好）
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`${status} ${message}`);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
  if (!res.ok) throw new HttpError(res.status, (await res.json().catch(() => ({}))).error ?? "");
  return res.json();
}

export const report = (bin_id: number, source: Source, kind: Kind) =>
  call<Case>("/api/reports", { method: "POST", body: JSON.stringify({ bin_id, source, kind }) });

export const advance = (id: number, status: "assigned" | "done") =>
  call<Case>(`/api/cases/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });

export const clearCases = () => call<{ ok: true }>("/api/cases", { method: "DELETE" });

// path 改成 null 就停止輪詢，已拿到的 data 與 error 會保留。
// 404 不會自己好，until(data) 成立代表資料不會再變，這兩種情況也停止輪詢；until 要傳模組層級的函式，否則每次 render 都會重新輪詢
export function usePoll<T>(path: string | null, ms = 2000, until?: (data: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const load = () =>
      call<T>(path).then(
        (d) => {
          if (!alive) return;
          setData(d);
          setError(null);
          if (until?.(d)) clearInterval(timer);
        },
        (e) => {
          if (!alive) return;
          setError(e);
          if (e instanceof HttpError && e.status === 404) clearInterval(timer);
        },
      );
    const timer = setInterval(load, ms);
    load();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, ms, until, tick]);
  return [data, () => setTick((t) => t + 1), error] as const;
}
