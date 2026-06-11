import "server-only";

import type { Fundamentals, FundamentalsQuarter, Prices } from "./types";

// With yfinance, most tickers only return 5–8 quarterly snapshots — that gives
// 2–5 trailing-TTM P/E samples. Setting MIN_HISTORY below 2 would make the
// std meaningless; setting it higher than 2 hides all signal on yfinance data.
const MIN_HISTORY = 2;
const Z_CLAMP = 3;
const WINSOR = 3;
const TRADING_DAYS_1Y = 252;
const TRADING_DAYS_5Y = 252 * 5;

function lastClose(prices: Prices, ticker: string): number | null {
  const block = prices.data[ticker];
  if (!block || block.close.length === 0) return null;
  const v = block.close[block.close.length - 1];
  return Number.isFinite(v) && v > 0 ? v : null;
}

function priceOnOrBefore(prices: Prices, ticker: string, isoDate: string): number | null {
  const block = prices.data[ticker];
  if (!block) return null;
  let lo = 0;
  let hi = block.dates.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (block.dates[mid] <= isoDate) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const v = block.close[best];
  return Number.isFinite(v) && v > 0 ? v : null;
}

function trailingPe(quarters: FundamentalsQuarter[], untilIdx: number, priceAtFde: number): number | null {
  const slice = quarters.slice(untilIdx, untilIdx + 4);
  if (slice.length < 4) return null;
  let ttm = 0;
  for (const q of slice) {
    if (q.eps === null || !Number.isFinite(q.eps)) return null;
    ttm += q.eps;
  }
  if (ttm <= 0) return null;
  return priceAtFde / ttm;
}

function meanAndStd(xs: number[]): { mean: number; std: number } {
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

function winsorize(xs: number[], limit: number): number[] {
  if (xs.length === 0) return xs;
  const { mean, std } = meanAndStd(xs);
  if (std === 0) return xs;
  return xs.map((x) => {
    const z = (x - mean) / std;
    if (z > limit) return mean + limit * std;
    if (z < -limit) return mean - limit * std;
    return x;
  });
}

export type PeHistoryPoint = {
  /** "2024-Q3" */
  period: string;
  /** "2024-09-30" */
  fde: string;
  /** Trailing TTM P/E at that quarter end, or null if not computable. */
  pe: number | null;
};

export type TrailingPeStats = {
  /** Trailing TTM P/E based on the most recent close, or null. */
  current: number | null;
  /** Per-quarter trailing TTM P/E series, newest first. */
  history: PeHistoryPoint[];
  /** Mean across the (winsorized) numeric history values, used for z-score. */
  ownMean: number;
  /** Std across the (winsorized) numeric history values. */
  ownStd: number;
  /** Z-score of `current` against history, clamped to [-3, +3]. 0 if uncomputable. */
  zScore: number;
};

/** Computes the full trailing-P/E story for one ticker. Returns nulls in the
 * fields it cannot compute (missing data) instead of throwing. */
export function trailingPeStats(
  ticker: string,
  prices: Prices,
  fundamentals: Fundamentals,
): TrailingPeStats {
  const empty: TrailingPeStats = {
    current: null,
    history: [],
    ownMean: 0,
    ownStd: 0,
    zScore: 0,
  };
  const block = fundamentals.data[ticker];
  if (!block) return empty;
  const quarters = block.quarters;
  if (quarters.length === 0) return empty;

  const history: PeHistoryPoint[] = [];
  const numericValues: number[] = [];
  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i];
    const priceAt = priceOnOrBefore(prices, ticker, q.fiscal_date_ending);
    const pe = priceAt === null ? null : trailingPe(quarters, i, priceAt);
    history.push({ period: q.period, fde: q.fiscal_date_ending, pe });
    if (pe !== null && Number.isFinite(pe)) numericValues.push(pe);
  }

  const latestPrice = lastClose(prices, ticker);
  const current = latestPrice === null ? null : trailingPe(quarters, 0, latestPrice);

  if (numericValues.length < MIN_HISTORY || current === null) {
    return { current, history, ownMean: 0, ownStd: 0, zScore: 0 };
  }

  const tamed = winsorize(numericValues, WINSOR);
  const { mean, std } = meanAndStd(tamed);
  if (std === 0) {
    return { current, history, ownMean: mean, ownStd: 0, zScore: 0 };
  }
  const z = (current - mean) / std;
  return {
    current,
    history,
    ownMean: mean,
    ownStd: std,
    zScore: Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z)),
  };
}

/** Back-compat shim used by force-layout. */
export function peZScore(
  ticker: string,
  prices: Prices,
  fundamentals: Fundamentals,
): number {
  return trailingPeStats(ticker, prices, fundamentals).zScore;
}

/** Total return between latest close and the close N trading days earlier.
 * Returns null if we don't have enough history. */
export function returnOverDays(
  prices: Prices,
  ticker: string,
  days: number,
): number | null {
  const block = prices.data[ticker];
  if (!block || block.close.length === 0) return null;
  const lastIdx = block.close.length - 1;
  const past = lastIdx - days;
  if (past < 0) return null;
  const a = block.close[past];
  const b = block.close[lastIdx];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  return b / a - 1;
}

export function return1Y(prices: Prices, ticker: string): number | null {
  return returnOverDays(prices, ticker, TRADING_DAYS_1Y);
}

export function return5Y(prices: Prices, ticker: string): number | null {
  return returnOverDays(prices, ticker, TRADING_DAYS_5Y);
}
