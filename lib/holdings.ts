"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Holding = {
  ticker: string;
  shares: number;
  addedAt: string;
};

type HoldingsState = {
  holdings: Holding[];
  showOnlyHoldings: boolean;
  hasHydrated: boolean;
  /** When false, persist middleware skips writing changes — used after the
   * user dismissed the "save shared portfolio" banner with No. */
  persistEnabled: boolean;
  /** Set while the URL provided holdings the user hasn't yet accepted/declined. */
  pendingUrlHoldings: Holding[] | null;

  add: (ticker: string, shares: number) => void;
  remove: (ticker: string) => void;
  update: (ticker: string, shares: number) => void;
  setHoldings: (holdings: Holding[]) => void;
  clear: () => void;

  setShowOnlyHoldings: (v: boolean) => void;
  setPersistEnabled: (v: boolean) => void;
  setHasHydrated: (v: boolean) => void;
  setPendingUrlHoldings: (v: Holding[] | null) => void;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase().trim();
}

export const useHoldingsStore = create<HoldingsState>()(
  persist(
    (set, get) => ({
      holdings: [],
      showOnlyHoldings: false,
      hasHydrated: false,
      persistEnabled: true,
      pendingUrlHoldings: null,

      add: (ticker, shares) => {
        if (!Number.isFinite(shares) || shares <= 0) return;
        const norm = normalizeTicker(ticker);
        if (norm === "") return;
        const existing = get().holdings;
        const i = existing.findIndex((h) => h.ticker === norm);
        if (i >= 0) {
          // Update-on-duplicate semantics.
          const next = [...existing];
          next[i] = { ...next[i], shares };
          set({ holdings: next });
        } else {
          set({ holdings: [...existing, { ticker: norm, shares, addedAt: nowIso() }] });
        }
      },

      remove: (ticker) => {
        const norm = normalizeTicker(ticker);
        set({ holdings: get().holdings.filter((h) => h.ticker !== norm) });
      },

      update: (ticker, shares) => {
        if (!Number.isFinite(shares) || shares <= 0) return;
        const norm = normalizeTicker(ticker);
        set({
          holdings: get().holdings.map((h) =>
            h.ticker === norm ? { ...h, shares } : h,
          ),
        });
      },

      setHoldings: (holdings) => set({ holdings }),
      clear: () => set({ holdings: [] }),

      setShowOnlyHoldings: (v) => set({ showOnlyHoldings: v }),
      setPersistEnabled: (v) => set({ persistEnabled: v }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
      setPendingUrlHoldings: (v) => set({ pendingUrlHoldings: v }),
    }),
    {
      name: "portfolio-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        state.persistEnabled ? { holdings: state.holdings } : { holdings: [] },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

// --- URL encoding / parsing ---

export function encodeHoldingsParam(holdings: Holding[]): string {
  const sorted = [...holdings].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return sorted
    .map((h) => {
      // Don't render trailing zeros on integer share counts.
      const shares =
        Number.isInteger(h.shares) ? String(h.shares) : String(h.shares);
      return `${h.ticker}:${shares}`;
    })
    .join(",");
}

export function parseHoldingsParam(
  raw: string | null | undefined,
  validTickers: Set<string>,
): Holding[] {
  if (!raw) return [];
  const decoded = decodeURIComponent(raw);
  const segments = decoded.split(",");
  const ts = nowIso();
  const out: Holding[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const [rawTicker, rawShares] = seg.split(":");
    if (rawTicker === undefined || rawShares === undefined) continue;
    const ticker = normalizeTicker(rawTicker);
    if (ticker === "" || !validTickers.has(ticker)) continue;
    if (seen.has(ticker)) continue;
    const shares = Number(rawShares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    out.push({ ticker, shares, addedAt: ts });
    seen.add(ticker);
  }
  return out;
}

export function holdingsEqual(a: Holding[], b: Holding[]): boolean {
  if (a.length !== b.length) return false;
  const mapA = new Map(a.map((h) => [h.ticker, h.shares]));
  for (const h of b) {
    const v = mapA.get(h.ticker);
    if (v === undefined || v !== h.shares) return false;
  }
  return true;
}

export function buildShareUrl(holdings: Holding[]): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  if (holdings.length === 0) {
    url.searchParams.delete("holdings");
  } else {
    url.searchParams.set("holdings", encodeHoldingsParam(holdings));
  }
  return url.toString();
}
