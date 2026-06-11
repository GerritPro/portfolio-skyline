"use client";

import { InsiderDataSchema, type InsiderData } from "./types";

const cache = new Map<string, InsiderData>();
const inFlight = new Map<string, Promise<InsiderData>>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeInsiderCache(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCachedInsider(ticker: string): InsiderData | undefined {
  return cache.get(ticker.toUpperCase());
}

export async function fetchInsider(ticker: string): Promise<InsiderData> {
  const k = ticker.toUpperCase();
  const cached = cache.get(k);
  if (cached) return cached;
  const existing = inFlight.get(k);
  if (existing) return existing;

  const p = fetch(`/data/stocks/${k}/insider.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`insider fetch ${k}: HTTP ${r.status}`);
      return r.json();
    })
    .then((raw) => {
      const parsed = InsiderDataSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`insider schema invalid: ${parsed.error.message}`);
      cache.set(k, parsed.data);
      notify();
      return parsed.data;
    })
    .finally(() => {
      inFlight.delete(k);
    });

  inFlight.set(k, p);
  return p;
}
