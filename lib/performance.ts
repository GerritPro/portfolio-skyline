/**
 * Portfolio performance maths — pure, dependency-free, runs on either
 * side. Takes date-aligned price/FX columns (see /api/history) plus the
 * current holdings and returns the EUR equity curve and its derived
 * statistics.
 *
 * Framing: this is the *current basket held backward through time* —
 * i.e. "what if I'd always owned exactly these share counts." It is not
 * realised P&L (we have no transaction history). The window is clamped
 * to where every covered holding has price data, so a recently-listed
 * holding shortens the curve rather than faking a flat line.
 */

import type { Holding } from "./holdings";

export type HistoryResponse = {
  ok: boolean;
  range: string;
  start: string | null;
  end: string | null;
  dates: string[];
  series: Record<string, (number | null)[]>;
  fx: Record<string, number[]>;
  missing: string[];
};

export type EquityPoint = {
  date: string;
  /** EUR value of the basket on this date. */
  value: number;
  /** Value rebased so the first point = 100. */
  indexed: number;
  /** Drawdown from the running peak, in [-1, 0]. */
  drawdown: number;
};

export type Contribution = {
  ticker: string;
  /** Weight at the start of the window (sums to 1 across covered names). */
  weightStart: number;
  /** Total local-return × FX over the window. */
  ret: number;
  /** weightStart × ret — these sum exactly to the basket's total return. */
  contribution: number;
};

export type PerformanceResult = {
  points: EquityPoint[];
  startValue: number;
  endValue: number;
  startDate: string;
  endDate: string;
  /** Years spanned, for annualisation. */
  years: number;
  totalReturn: number;
  /** Compound annual growth rate; null when the window is < ~a month. */
  cagr: number | null;
  maxDrawdown: number;
  maxDrawdownDate: string | null;
  /** Annualised stdev of per-period log returns. */
  annualVol: number | null;
  /** cagr / annualVol, risk-free = 0. */
  sharpe: number | null;
  bestDay: { date: string; ret: number } | null;
  worstDay: { date: string; ret: number } | null;
  contributions: Contribution[];
  coveredTickers: string[];
  missingTickers: string[];
  /** Holdings dropped because their price history starts inside the window. */
  limitedBy: { ticker: string; firstDate: string } | null;
};

function fxFor(
  fx: Record<string, number[]>,
  currency: string,
  i: number,
): number {
  const ccy = currency.toUpperCase();
  if (ccy === "EUR") return 1;
  const arr = fx[ccy];
  const v = arr?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
}

export function computePerformance(
  holdings: Holding[],
  history: HistoryResponse,
  currencyByTicker: Record<string, string>,
): PerformanceResult | null {
  const { dates, series, fx } = history;
  if (dates.length < 2 || holdings.length === 0) return null;

  // Which holdings have a series at all.
  const missingTickers: string[] = [];
  const covered: { ticker: string; shares: number; close: (number | null)[]; ccy: string }[] = [];
  for (const h of holdings) {
    const close = series[h.ticker];
    if (!close) {
      missingTickers.push(h.ticker);
      continue;
    }
    covered.push({
      ticker: h.ticker,
      shares: h.shares,
      close,
      ccy: (currencyByTicker[h.ticker] ?? "USD").toUpperCase(),
    });
  }
  if (covered.length === 0) return null;

  // Clamp the start to the date where *every* covered holding has data
  // (its first non-null close). The latest such index wins.
  let startIdx = 0;
  let limitedBy: { ticker: string; firstDate: string } | null = null;
  for (const c of covered) {
    let first = c.close.findIndex((v) => v !== null && Number.isFinite(v));
    if (first < 0) first = c.close.length; // never valid
    if (first > startIdx) {
      startIdx = first;
      limitedBy = { ticker: c.ticker, firstDate: dates[Math.min(first, dates.length - 1)] };
    }
  }
  // If the clamp ate everything, give up.
  if (startIdx >= dates.length - 1) return null;
  // Only flag "limitedBy" when the clamp actually moved past the window start.
  if (startIdx === 0) limitedBy = null;

  // Build the EUR value series from startIdx onward.
  const points: EquityPoint[] = [];
  let peak = -Infinity;
  let maxDrawdown = 0;
  let maxDrawdownDate: string | null = null;

  for (let i = startIdx; i < dates.length; i++) {
    let value = 0;
    let ok = false;
    for (const c of covered) {
      const px = c.close[i];
      if (px === null || !Number.isFinite(px)) continue;
      value += c.shares * px * fxFor(fx, c.ccy, i);
      ok = true;
    }
    if (!ok) continue;
    if (value > peak) peak = value;
    const drawdown = peak > 0 ? value / peak - 1 : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDate = dates[i];
    }
    points.push({ date: dates[i], value, indexed: 0, drawdown });
  }
  if (points.length < 2) return null;

  const startValue = points[0].value;
  const endValue = points[points.length - 1].value;
  if (startValue <= 0) return null;
  for (const p of points) p.indexed = (p.value / startValue) * 100;

  const totalReturn = endValue / startValue - 1;

  const startDate = points[0].date;
  const endDate = points[points.length - 1].date;
  const years =
    (new Date(endDate + "T00:00:00Z").getTime() -
      new Date(startDate + "T00:00:00Z").getTime()) /
    (365.25 * 24 * 3600 * 1000);

  const cagr = years > 0.08 ? Math.pow(endValue / startValue, 1 / years) - 1 : null;

  // Per-period log returns for vol; track best/worst simple-return day.
  const logRets: number[] = [];
  let bestDay: { date: string; ret: number } | null = null;
  let worstDay: { date: string; ret: number } | null = null;
  for (let i = 1; i < points.length; i++) {
    const r = points[i].value / points[i - 1].value - 1;
    if (Number.isFinite(r)) {
      logRets.push(Math.log(1 + r));
      if (!bestDay || r > bestDay.ret) bestDay = { date: points[i].date, ret: r };
      if (!worstDay || r < worstDay.ret) worstDay = { date: points[i].date, ret: r };
    }
  }

  let annualVol: number | null = null;
  if (logRets.length >= 5 && years > 0) {
    const mean = logRets.reduce((s, x) => s + x, 0) / logRets.length;
    const variance =
      logRets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (logRets.length - 1);
    const periodsPerYear = points.length / years;
    annualVol = Math.sqrt(variance) * Math.sqrt(periodsPerYear);
  }

  const sharpe =
    cagr !== null && annualVol !== null && annualVol > 1e-9 ? cagr / annualVol : null;

  // Contribution decomposition: weightStart × windowReturn. For a held
  // basket these sum *exactly* to totalReturn, so the bars reconcile.
  const startVals: { ticker: string; v0: number; v1: number }[] = [];
  for (const c of covered) {
    const px0 = c.close[startIdx];
    const px1 = c.close[dates.length - 1];
    if (px0 === null || px1 === null || !Number.isFinite(px0) || !Number.isFinite(px1)) continue;
    const v0 = c.shares * px0 * fxFor(fx, c.ccy, startIdx);
    const v1 = c.shares * px1 * fxFor(fx, c.ccy, dates.length - 1);
    if (v0 > 0) startVals.push({ ticker: c.ticker, v0, v1 });
  }
  const totalV0 = startVals.reduce((s, x) => s + x.v0, 0);
  const contributions: Contribution[] = startVals
    .map((x) => {
      const weightStart = totalV0 > 0 ? x.v0 / totalV0 : 0;
      const ret = x.v1 / x.v0 - 1;
      return { ticker: x.ticker, weightStart, ret, contribution: weightStart * ret };
    })
    .sort((a, b) => b.contribution - a.contribution);

  return {
    points,
    startValue,
    endValue,
    startDate,
    endDate,
    years,
    totalReturn,
    cagr,
    maxDrawdown,
    maxDrawdownDate,
    annualVol,
    sharpe,
    bestDay,
    worstDay,
    contributions,
    coveredTickers: covered.map((c) => c.ticker),
    missingTickers,
    limitedBy,
  };
}
