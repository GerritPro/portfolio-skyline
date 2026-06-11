import { convertToEur, type FxRates } from "./format";
import type { Correlations, RiskFactors } from "./types";
import type { Holding } from "./holdings";

export type SectorWeight = { sector: string; weight: number };

export function totalValue(
  holdings: Holding[],
  lastCloseByTicker: Record<string, number>,
): number {
  let v = 0;
  for (const h of holdings) {
    const px = lastCloseByTicker[h.ticker];
    if (typeof px === "number" && Number.isFinite(px)) {
      v += h.shares * px;
    }
  }
  return v;
}

export function valueByTicker(
  holdings: Holding[],
  lastCloseByTicker: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of holdings) {
    const px = lastCloseByTicker[h.ticker];
    if (typeof px === "number" && Number.isFinite(px)) {
      out[h.ticker] = h.shares * px;
    }
  }
  return out;
}

export function sectorBreakdown(
  holdings: Holding[],
  values: Record<string, number>,
  sectorByTicker: Record<string, string | null>,
): SectorWeight[] {
  let total = 0;
  for (const h of holdings) total += values[h.ticker] ?? 0;
  if (total <= 0) return [];
  const acc = new Map<string, number>();
  for (const h of holdings) {
    const v = values[h.ticker] ?? 0;
    const sector = sectorByTicker[h.ticker] ?? "Unknown";
    acc.set(sector, (acc.get(sector) ?? 0) + v);
  }
  const out: SectorWeight[] = [];
  for (const [sector, v] of acc) out.push({ sector, weight: v / total });
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

export function hhi(weights: number[]): number {
  let sum = 0;
  for (const w of weights) sum += w * w;
  return sum;
}

export function avgWeightedZ(
  holdings: Holding[],
  values: Record<string, number>,
  zByTicker: Record<string, number>,
): number | null {
  let totalValue = 0;
  let weighted = 0;
  let nWithZ = 0;
  for (const h of holdings) {
    const v = values[h.ticker];
    const z = zByTicker[h.ticker];
    if (typeof v !== "number" || typeof z !== "number") continue;
    if (z === 0) {
      // We treat 0 as "no signal" because finance-metrics returns 0 for
      // insufficient-history tickers. Including those would bias avg toward 0.
      totalValue += v;
      continue;
    }
    totalValue += v;
    weighted += z * v;
    nWithZ += 1;
  }
  if (totalValue <= 0 || nWithZ === 0) return null;
  return weighted / totalValue;
}

export function totalValueEur(
  holdings: Holding[],
  lastCloseByTicker: Record<string, number>,
  currencyByTicker: Record<string, string>,
  fx: FxRates | null,
): number {
  let total = 0;
  for (const h of holdings) {
    const px = lastCloseByTicker[h.ticker];
    if (typeof px !== "number" || !Number.isFinite(px)) continue;
    const ccy = currencyByTicker[h.ticker] ?? "USD";
    const localValue = h.shares * px;
    const eur = convertToEur(localValue, ccy, fx);
    if (eur !== null) total += eur;
  }
  return total;
}

export function eurValueByTicker(
  holdings: Holding[],
  lastCloseByTicker: Record<string, number>,
  currencyByTicker: Record<string, string>,
  fx: FxRates | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of holdings) {
    const px = lastCloseByTicker[h.ticker];
    if (typeof px !== "number" || !Number.isFinite(px)) continue;
    const ccy = currencyByTicker[h.ticker] ?? "USD";
    const eur = convertToEur(h.shares * px, ccy, fx);
    if (eur !== null) out[h.ticker] = eur;
  }
  return out;
}

export type CurrencyWeight = { currency: string; weight: number };

export function currencyExposure(
  holdings: Holding[],
  lastCloseByTicker: Record<string, number>,
  currencyByTicker: Record<string, string>,
  fx: FxRates | null,
): CurrencyWeight[] {
  const byCurrency = new Map<string, number>();
  let total = 0;
  for (const h of holdings) {
    const px = lastCloseByTicker[h.ticker];
    if (typeof px !== "number" || !Number.isFinite(px)) continue;
    const ccy = (currencyByTicker[h.ticker] ?? "USD").toUpperCase();
    const eur = convertToEur(h.shares * px, ccy, fx);
    if (eur === null) continue;
    byCurrency.set(ccy, (byCurrency.get(ccy) ?? 0) + eur);
    total += eur;
  }
  if (total <= 0) return [];
  return Array.from(byCurrency.entries())
    .map(([currency, value]) => ({ currency, weight: value / total }))
    .sort((a, b) => b.weight - a.weight);
}

export type RiskDecomposition = {
  portfolioBeta: number;
  /** Daily standard deviations, decomposed assuming orthogonal factors. */
  marketVol: number;
  sectorVol: number;
  idioVol: number;
  totalVol: number;
  /** Variance shares (0..1) summing to 1. */
  marketShare: number;
  sectorShare: number;
  idioShare: number;
  /** Number of holdings the model could cover. */
  covered: number;
  /** Number of holdings we skipped (missing from risk_factors). */
  missing: number;
  /** Per-holding decomposition, weighted by EUR value. */
  byTicker: Array<{
    ticker: string;
    weight: number;
    betaMarket: number;
    betaSector: number;
    /** Per-holding contribution to total variance (weight² σ-terms). */
    marketContrib: number;
    sectorContrib: number;
    idioContrib: number;
  }>;
};

export function decomposeRisk(
  holdings: Holding[],
  eurValues: Record<string, number>,
  factors: RiskFactors,
): RiskDecomposition | null {
  const covered: { h: Holding; weight: number; rf: RiskFactors["factors"][string] }[] = [];
  let totalEur = 0;
  let missing = 0;
  for (const h of holdings) {
    const v = eurValues[h.ticker];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    const rf = factors.factors[h.ticker];
    if (!rf) {
      missing += 1;
      continue;
    }
    totalEur += v;
    covered.push({ h, weight: v, rf });
  }
  if (totalEur <= 0 || covered.length === 0) return null;
  // Convert raw EUR weights to portfolio weights.
  for (const c of covered) c.weight = c.weight / totalEur;

  const marketVar = factors.market_var;
  const sectorVar = factors.sector_var;

  // Portfolio loading on market: Σ w_i β_market,i
  const portfolioBeta = covered.reduce((s, c) => s + c.weight * c.rf.beta_market, 0);

  // Portfolio loading per sector: Σ_{i in sector s} w_i β_sector,i
  const sectorLoading = new Map<string, number>();
  for (const c of covered) {
    const s = c.rf.sector;
    if (!s) continue;
    sectorLoading.set(s, (sectorLoading.get(s) ?? 0) + c.weight * c.rf.beta_sector);
  }

  // Variance contributions (orthogonal factors → variances are additive).
  const marketVariance = portfolioBeta * portfolioBeta * marketVar;
  let sectorVariance = 0;
  for (const [s, load] of sectorLoading) {
    const sv = sectorVar[s];
    if (typeof sv === "number") sectorVariance += load * load * sv;
  }
  let idioVariance = 0;
  for (const c of covered) {
    idioVariance += c.weight * c.weight * c.rf.idio_std * c.rf.idio_std;
  }
  const totalVariance = marketVariance + sectorVariance + idioVariance;

  const byTicker = covered.map((c) => {
    // Per-holding marginal contribution to each component.
    const market = c.weight * c.rf.beta_market * portfolioBeta * marketVar;
    const sectorLoad = c.rf.sector ? (sectorLoading.get(c.rf.sector) ?? 0) : 0;
    const sectorVarForS = c.rf.sector ? (sectorVar[c.rf.sector] ?? 0) : 0;
    const sector = c.weight * c.rf.beta_sector * sectorLoad * sectorVarForS;
    const idio = c.weight * c.weight * c.rf.idio_std * c.rf.idio_std;
    return {
      ticker: c.h.ticker,
      weight: c.weight,
      betaMarket: c.rf.beta_market,
      betaSector: c.rf.beta_sector,
      marketContrib: market,
      sectorContrib: sector,
      idioContrib: idio,
    };
  });

  return {
    portfolioBeta,
    marketVol: Math.sqrt(Math.max(0, marketVariance)),
    sectorVol: Math.sqrt(Math.max(0, sectorVariance)),
    idioVol: Math.sqrt(Math.max(0, idioVariance)),
    totalVol: Math.sqrt(Math.max(0, totalVariance)),
    marketShare: totalVariance > 0 ? marketVariance / totalVariance : 0,
    sectorShare: totalVariance > 0 ? sectorVariance / totalVariance : 0,
    idioShare: totalVariance > 0 ? idioVariance / totalVariance : 0,
    covered: covered.length,
    missing,
    byTicker,
  };
}

export function avgCrossCorrelation(
  holdings: Holding[],
  correlations: Correlations,
): number | null {
  if (holdings.length < 2) return null;
  const tickerToIdx = new Map<string, number>();
  correlations.tickers.forEach((t, i) => tickerToIdx.set(t, i));

  const indices: number[] = [];
  for (const h of holdings) {
    const i = tickerToIdx.get(h.ticker);
    if (i !== undefined) indices.push(i);
  }
  if (indices.length < 2) return null;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const v = correlations.matrix[indices[i]][indices[j]];
      if (Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
  }
  return count === 0 ? null : sum / count;
}
