import { loadDashboardPrep } from "@/lib/dashboard-prep-loader";
import type { DetailMap, TickerDetail } from "@/lib/detail-data";
import { loadMarketGex } from "@/lib/market-gex-loader";
import { colorForSector, normalizeSector } from "@/lib/sector-colors";
import { loadBrandColorMap, loadLastUpdate, type LastUpdateStamps } from "@/lib/stock-data-loader";
import {
  PipelineMissingError,
  PipelineValidationError,
  type Fx,
  type MarketGex,
  type Metadata,
  type Profile,
} from "@/lib/types";

import { Dashboard } from "./Dashboard";
import { HoldingsBoot } from "./HoldingsBoot";
import { ValidationError } from "./ValidationError";

// Module-level promise cache. The Dashboard now reads precomputed slim
// JSON (dashboard_prep.json, 244KB) — heavy prices.json / fundamentals.json
// stay on disk for per-stock detail pages only. Cache keeps the parsed
// object alive across requests; HMR invalidates it on source changes.
const cache: { promise: Promise<PreparedOrError> | null } = { promise: null };

type PreparedOrError =
  | { kind: "ok"; prep: Prepared }
  | { kind: "missing"; file: string }
  | { kind: "invalid"; file: string; issues: { path: string; message: string }[] };

type Prepared = {
  metadata: Metadata;
  details: DetailMap;
  tickerProfiles: Profile[];
  validTickers: string[];
  lastCloseByTicker: Record<string, number>;
  sectorByTicker: Record<string, string | null>;
  zByTicker: Record<string, number>;
  return1dByTicker: Record<string, number | null>;
  return1mByTicker: Record<string, number | null>;
  return1yByTicker: Record<string, number | null>;
  sectorCount: number;
  marketGex: MarketGex | null;
  fx: Fx | null;
  currencyByTicker: Record<string, string>;
  brandColorByTicker: Record<string, string>;
  lastUpdate: LastUpdateStamps;
};

async function buildPrepared(): Promise<PreparedOrError> {
  try {
    const { prep: slim, sectors, metadata, fx } = await loadDashboardPrep();

    const tickerProfiles = [...slim.universeTickers].sort((a, b) =>
      a.ticker.localeCompare(b.ticker),
    );
    const validTickers = tickerProfiles.map((p) => p.ticker);

    const sectorByTicker: Record<string, string | null> = {};
    const currencyByTicker: Record<string, string> = {};
    for (const p of slim.universeTickers) {
      sectorByTicker[p.ticker] = normalizeSector(p.sector);
      currencyByTicker[p.ticker] = (p.currency ?? "USD").toUpperCase();
    }

    // Build a minimal DetailMap satisfying the client components without
    // shipping the per-quarter history arrays — those live in per-ticker
    // metric JSON files and the stock-detail pages load them on demand.
    const details: DetailMap = {};
    const zByTicker: Record<string, number> = {};
    const return1dByTicker: Record<string, number | null> = {};
    const return1mByTicker: Record<string, number | null> = {};
    const return1yByTicker: Record<string, number | null> = {};
    const lastCloseByTicker: Record<string, number> = { ...slim.lastClose };

    for (const p of slim.universeTickers) {
      const byT = slim.byTicker[p.ticker];
      if (!byT) continue;
      const sector = normalizeSector(p.sector);
      const detail: TickerDetail = {
        ticker: p.ticker,
        name: p.name,
        sector,
        color: colorForSector(sector),
        currentPe: byT.currentPe,
        ownMean: byT.ownMean,
        ownStd: byT.ownStd,
        zScore: byT.zScore,
        sectorMedianPeNow: null,
        premiumVsSector: null,
        marketCap: p.market_cap,
        price: lastCloseByTicker[p.ticker] ?? null,
        return1d: byT.return1d,
        return1m: byT.return1m,
        return1y: byT.return1y,
        return5y: byT.return5y,
        series: [],
        ownMeanLine: byT.ownMean,
        quarterlySeries: [],
        lastUpdate: metadata.data_version,
      };
      details[p.ticker] = detail;
      zByTicker[p.ticker] = byT.zScore;
      return1dByTicker[p.ticker] = byT.return1d;
      return1mByTicker[p.ticker] = byT.return1m;
      return1yByTicker[p.ticker] = byT.return1y;
    }

    const marketGex = await loadMarketGex();
    const brandColorByTicker = await loadBrandColorMap(validTickers);
    const lastUpdate = await loadLastUpdate();

    return {
      kind: "ok",
      prep: {
        metadata,
        details,
        tickerProfiles,
        validTickers,
        lastCloseByTicker,
        sectorByTicker,
        zByTicker,
        return1dByTicker,
        return1mByTicker,
        return1yByTicker,
        sectorCount: Object.keys(sectors.sectors).length,
        marketGex,
        fx,
        currencyByTicker,
        brandColorByTicker,
        lastUpdate,
      },
    };
  } catch (err) {
    if (err instanceof PipelineMissingError) {
      cache.promise = null;
      return { kind: "missing", file: err.file };
    }
    if (err instanceof PipelineValidationError) {
      cache.promise = null;
      return { kind: "invalid", file: err.file, issues: err.issues };
    }
    cache.promise = null;
    throw err;
  }
}

export async function DashboardServer() {
  // eslint-disable-next-line react-hooks/immutability
  if (!cache.promise) cache.promise = buildPrepared();
  const result = await cache.promise;

  if (result.kind === "missing") {
    return (
      <ValidationError
        title="Pipeline output missing"
        detail={`No ${result.file} found in public/data/. Run the dashboard precompute step.`}
        file={result.file}
        hint={`uv run python pipeline/build_dashboard_prep.py`}
      />
    );
  }
  if (result.kind === "invalid") {
    return (
      <ValidationError
        title="Pipeline data is not valid"
        detail={`Schema validation failed for ${result.file}.`}
        file={result.file}
        issues={result.issues}
      />
    );
  }

  const prep = result.prep;

  return (
    <>
      <Dashboard
        metadata={prep.metadata}
        details={prep.details}
        tickerProfiles={prep.tickerProfiles}
        lastCloseByTicker={prep.lastCloseByTicker}
        sectorByTicker={prep.sectorByTicker}
        zByTicker={prep.zByTicker}
        return1dByTicker={prep.return1dByTicker}
        return1mByTicker={prep.return1mByTicker}
        return1yByTicker={prep.return1yByTicker}
        sectorCount={prep.sectorCount}
        marketGex={prep.marketGex}
        fx={prep.fx}
        currencyByTicker={prep.currencyByTicker}
        brandColorByTicker={prep.brandColorByTicker}
        lastUpdate={prep.lastUpdate}
      />
      <HoldingsBoot validTickers={prep.validTickers} />
    </>
  );
}
