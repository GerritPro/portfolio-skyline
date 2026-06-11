"use client";

import type { MetricFormat, MetricKey } from "./metric-catalog";

export type MetricQuarterPoint = {
  period: string;
  fiscalDate: string | null;
  value: number | null;
};

export type MetricPeriodValue = {
  period: string;
  value: number;
};

export type MetricViewKey = "quarterly" | "ttm";

export type MetricViewStats = {
  current: number | null;
  qoq: number | null;
  yoy: number | null;
  cagr5y: number | null;
  avg5y: number | null;
  peak: MetricPeriodValue | null;
  low: MetricPeriodValue | null;
  started: MetricPeriodValue | null;
  series: MetricQuarterPoint[];
};

export type MetricData = {
  metric: MetricKey;
  label: string;
  category: string;
  format: MetricFormat;
  isFlow: boolean;
  currency?: string | null;
  lastReportedDate: string | null;
  views: Record<MetricViewKey, MetricViewStats>;
};

const cache = new Map<string, MetricData>();
const inFlight = new Map<string, Promise<MetricData>>();
const listeners = new Set<() => void>();

function cacheKey(ticker: string, key: string): string {
  return `${ticker.toUpperCase()}/${key}`;
}

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeMetricCache(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCachedMetric(ticker: string, key: string): MetricData | undefined {
  return cache.get(cacheKey(ticker, key));
}

export async function fetchMetric(ticker: string, key: string): Promise<MetricData> {
  const k = cacheKey(ticker, key);
  const cached = cache.get(k);
  if (cached) return cached;
  const existing = inFlight.get(k);
  if (existing) return existing;

  const p = fetch(`/data/stocks/${ticker.toUpperCase()}/metrics/${key}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`metric fetch ${k}: HTTP ${r.status}`);
      return r.json() as Promise<MetricData>;
    })
    .then((d) => {
      cache.set(k, d);
      notify();
      return d;
    })
    .finally(() => {
      inFlight.delete(k);
    });

  inFlight.set(k, p);
  return p;
}
