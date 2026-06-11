"use client";

export type StockPriceSeries = {
  ticker: string;
  dates: string[];
  close: (number | null)[];
};

const cache = new Map<string, StockPriceSeries>();
const inFlight = new Map<string, Promise<StockPriceSeries>>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeStockPricesCache(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCachedStockPrices(ticker: string): StockPriceSeries | undefined {
  return cache.get(ticker.toUpperCase());
}

export async function fetchStockPrices(ticker: string): Promise<StockPriceSeries> {
  const k = ticker.toUpperCase();
  const cached = cache.get(k);
  if (cached) return cached;
  const existing = inFlight.get(k);
  if (existing) return existing;

  const p = fetch(`/data/stocks/${k}/prices.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`stock prices ${k}: HTTP ${r.status}`);
      return r.json() as Promise<StockPriceSeries>;
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
