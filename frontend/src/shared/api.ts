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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).error ?? ""}`);
  return res.json();
}

export const report = (bin_id: number, source: Source, kind: Kind) =>
  call<Case>("/api/reports", { method: "POST", body: JSON.stringify({ bin_id, source, kind }) });

export const advance = (id: number, status: "assigned" | "done") =>
  call<Case>(`/api/cases/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });

export function usePoll<T>(path: string | null, ms = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const load = () => call<T>(path).then((d) => alive && setData(d)).catch(() => {});
    load();
    const timer = setInterval(load, ms);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, ms, tick]);
  return [data, () => setTick((t) => t + 1)] as const;
}
