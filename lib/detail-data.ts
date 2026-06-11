import "server-only";

import {
  return1Y,
  return5Y,
  returnOverDays,
  trailingPeStats,
  type TrailingPeStats,
} from "./finance-metrics";
import { colorForSector, normalizeSector } from "./sector-colors";
import type { FundamentalsQuarter, PipelineData } from "./types";

const TRADING_DAYS_1M = 21;
const TAX_RATE_PROXY = 0.21;

export type DetailSeriesPoint = {
  period: string;
  fde: string;
  pe: number | null;
  sectorMedianPe: number | null;
};

export type QuarterlyPoint = {
  period: string;
  fde: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  grossMargin: number | null;
  opMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  roic: number | null;
};

export type TickerDetail = {
  ticker: string;
  name: string;
  sector: string | null;
  color: string;

  currentPe: number | null;
  ownMean: number;
  ownStd: number;
  zScore: number;
  sectorMedianPeNow: number | null;
  premiumVsSector: number | null;

  marketCap: number | null;
  price: number | null;
  return1d: number | null;
  return1m: number | null;
  return1y: number | null;
  return5y: number | null;

  series: DetailSeriesPoint[];
  ownMeanLine: number;
  quarterlySeries: QuarterlyPoint[];

  lastUpdate: string;
};

function sumNonNull(vals: (number | null | undefined)[]): number | null {
  let s = 0;
  for (const v of vals) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    s += v;
  }
  return s;
}

function safeRatio(num: number | null, den: number | null | undefined): number | null {
  if (num === null || den === null || den === undefined || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return num / den;
}

function computeQuarterlySeries(quarters: FundamentalsQuarter[]): QuarterlyPoint[] {
  // Providers store newest-first; for charts we want oldest→newest.
  const ordered = [...quarters].reverse();
  const out: QuarterlyPoint[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const q = ordered[i];
    const grossMargin =
      q.gross_profit !== null && q.gross_profit !== undefined
        ? safeRatio(q.gross_profit, q.revenue)
        : null;
    const opMargin = q.operating_margin ?? null;
    const netMargin = safeRatio(q.net_income, q.revenue);

    let roe: number | null = null;
    let roa: number | null = null;
    let roic: number | null = null;
    if (i >= 3) {
      const window = ordered.slice(i - 3, i + 1);
      const niTtm = sumNonNull(window.map((w) => w.net_income));
      const opTtm = sumNonNull(window.map((w) => w.operating_income ?? null));
      roe = safeRatio(niTtm, q.total_equity ?? null);
      roa = safeRatio(niTtm, q.total_assets ?? null);
      const investedCapital =
        q.total_equity !== null &&
        q.total_equity !== undefined &&
        q.total_debt !== null &&
        q.cash !== null
          ? q.total_equity + q.total_debt - q.cash
          : null;
      const nopat = opTtm === null ? null : opTtm * (1 - TAX_RATE_PROXY);
      roic = safeRatio(nopat, investedCapital);
    }

    out.push({
      period: q.period,
      fde: q.fiscal_date_ending,
      revenue: q.revenue,
      netIncome: q.net_income,
      eps: q.eps,
      grossMargin,
      opMargin,
      netMargin,
      roe,
      roa,
      roic,
    });
  }
  return out;
}

export type DetailMap = Record<string, TickerDetail>;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function medianOrNull(values: number[]): number | null {
  return values.length === 0 ? null : median(values);
}

export function computeDetails(data: PipelineData): DetailMap {
  const { universe, prices, fundamentals, metadata } = data;
  const lastUpdate = metadata.data_version;

  // Pre-compute peStats per ticker so we don't re-run the inner loop while
  // building each row's sector-median series.
  const statsByTicker = new Map<string, TrailingPeStats>();
  for (const profile of universe.tickers) {
    statsByTicker.set(profile.ticker, trailingPeStats(profile.ticker, prices, fundamentals));
  }

  // Group tickers by canonical sector.
  const tickersBySector = new Map<string, string[]>();
  for (const profile of universe.tickers) {
    const sector = normalizeSector(profile.sector);
    if (sector === null) continue;
    const arr = tickersBySector.get(sector);
    if (arr) arr.push(profile.ticker);
    else tickersBySector.set(sector, [profile.ticker]);
  }

  const out: DetailMap = {};
  for (const profile of universe.tickers) {
    const ticker = profile.ticker;
    const stats = statsByTicker.get(ticker)!;
    const sector = normalizeSector(profile.sector);

    const sectorMembers = sector === null ? [ticker] : tickersBySector.get(sector) ?? [ticker];

    // Sector-median trailing P/E *now* (across all sector members' current PE).
    const sectorCurrentValues: number[] = [];
    for (const peer of sectorMembers) {
      const s = statsByTicker.get(peer);
      if (s && s.current !== null && Number.isFinite(s.current)) {
        sectorCurrentValues.push(s.current);
      }
    }
    const sectorMedianPeNow = medianOrNull(sectorCurrentValues);

    let premiumVsSector: number | null = null;
    if (
      stats.current !== null &&
      sectorMedianPeNow !== null &&
      sectorMedianPeNow > 0 &&
      sectorMembers.length > 1
    ) {
      premiumVsSector = stats.current / sectorMedianPeNow - 1;
    }

    // Per-quarter sector-median series, aligned by FDE.
    const series: DetailSeriesPoint[] = [];
    for (const point of stats.history) {
      // Collect each peer's PE at the *same* fde (or closest available).
      let sectorMedianPe: number | null = null;
      if (sectorMembers.length > 1) {
        const peerPes: number[] = [];
        for (const peer of sectorMembers) {
          const peerStats = statsByTicker.get(peer);
          if (!peerStats) continue;
          const match = peerStats.history.find((h) => h.fde === point.fde);
          if (match && match.pe !== null && Number.isFinite(match.pe)) {
            peerPes.push(match.pe);
          }
        }
        sectorMedianPe = peerPes.length >= 2 ? median(peerPes) : null;
      }
      series.push({
        period: point.period,
        fde: point.fde,
        pe: point.pe,
        sectorMedianPe,
      });
    }
    // Recharts prefers oldest-first along the X axis.
    series.reverse();

    // Own-mean line for the chart — average of the non-null PE history.
    const numericPes = stats.history.flatMap((h) =>
      h.pe !== null && Number.isFinite(h.pe) ? [h.pe] : [],
    );
    const ownMeanLine =
      numericPes.length === 0 ? 0 : numericPes.reduce((s, x) => s + x, 0) / numericPes.length;

    const priceBlock = prices.data[ticker];
    const price =
      priceBlock && priceBlock.close.length > 0
        ? priceBlock.close[priceBlock.close.length - 1]
        : null;

    const fundBlock = fundamentals.data[ticker];
    const quarterlySeries = fundBlock ? computeQuarterlySeries(fundBlock.quarters) : [];

    out[ticker] = {
      ticker,
      name: profile.name,
      sector,
      color: colorForSector(sector),

      currentPe: stats.current,
      ownMean: stats.ownMean,
      ownStd: stats.ownStd,
      zScore: stats.zScore,
      sectorMedianPeNow,
      premiumVsSector,

      marketCap: profile.market_cap,
      price,
      return1d: returnOverDays(prices, ticker, 1),
      return1m: returnOverDays(prices, ticker, TRADING_DAYS_1M),
      return1y: return1Y(prices, ticker),
      return5y: return5Y(prices, ticker),

      series,
      ownMeanLine,
      quarterlySeries,

      lastUpdate,
    };
  }

  return out;
}
