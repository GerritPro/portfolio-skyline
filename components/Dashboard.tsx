"use client";

import { useEffect, useMemo, useState } from "react";

import { motion } from "motion/react";

import type { DetailMap } from "@/lib/detail-data";
import {
  formatPct,
  formatZ,
  toneFor,
} from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";
import { EASE_OUT_STRONG } from "@/lib/motion";
import {
  avgCrossCorrelation,
  avgWeightedZ,
  currencyExposure,
  hhi,
  sectorBreakdown,
  totalValueEur,
  valueByTicker,
} from "@/lib/portfolio-stats";
import type {
  Correlations,
  Fx,
  MarketGex as MarketGexData,
  Metadata,
  Profile,
} from "@/lib/types";
import { useLens } from "@/lib/use-lens";

import { AppHeader } from "./AppHeader";
import { HeroValue } from "./HeroValue";
import { LensPicker } from "./LensPicker";
import { LensView } from "./LensView";
import { MarketGex } from "./MarketGex";
import { SectionLabel } from "./SectionLabel";
import { StockSearchBar } from "./StockSearchBar";
import { CompositionDonut } from "./cards/CompositionDonut";
import { CorrelationHeatmapCard } from "./cards/CorrelationHeatmapCard";
import { HoldingsCard } from "./cards/HoldingsCard";
import { PerformanceCard } from "./cards/PerformanceCard";
import { RiskDecompositionCard } from "./cards/RiskDecompositionCard";
import { SectorExposureCard } from "./cards/SectorExposureCard";
import { TopMoversCard } from "./cards/TopMoversCard";
import { ZScoreStripCard } from "./cards/ZScoreStripCard";
import { InnovationLens } from "./lenses/InnovationLens";

type Props = {
  metadata: Metadata;
  details: DetailMap;
  tickerProfiles: Profile[];
  lastCloseByTicker: Record<string, number>;
  sectorByTicker: Record<string, string | null>;
  zByTicker: Record<string, number>;
  return1dByTicker: Record<string, number | null>;
  return1mByTicker: Record<string, number | null>;
  return1yByTicker: Record<string, number | null>;
  sectorCount: number;
  marketGex: MarketGexData | null;
  fx: Fx | null;
  currencyByTicker: Record<string, string>;
  brandColorByTicker: Record<string, string>;
  lastUpdate: import("@/lib/stock-data-loader").LastUpdateStamps;
};

function formatAsOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function portfolioReturn(
  holdings: { ticker: string; shares: number }[],
  lastCloseByTicker: Record<string, number>,
  returnByTicker: Record<string, number | null>,
): number | null {
  let totalNow = 0;
  let totalThen = 0;
  let any = false;
  for (const h of holdings) {
    const px = lastCloseByTicker[h.ticker];
    const ret = returnByTicker[h.ticker];
    if (typeof px !== "number" || ret === null || ret === undefined) continue;
    const now = px * h.shares;
    const then = now / (1 + ret);
    totalNow += now;
    totalThen += then;
    any = true;
  }
  if (!any || totalThen <= 0) return null;
  return totalNow / totalThen - 1;
}

export function Dashboard(props: Props) {
  const {
    metadata,
    details,
    tickerProfiles,
    lastCloseByTicker,
    sectorByTicker,
    zByTicker,
    return1dByTicker,
    return1mByTicker,
    return1yByTicker,
    sectorCount,
    marketGex,
    fx,
    currencyByTicker,
    brandColorByTicker,
    lastUpdate,
  } = props;

  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const holdings = useHoldingsStore((s) => s.holdings);

  const { lens, direction, setLens } = useLens();

  const total = useMemo(
    () => totalValueEur(holdings, lastCloseByTicker, currencyByTicker, fx),
    [holdings, lastCloseByTicker, currencyByTicker, fx],
  );
  const ccyExposure = useMemo(
    () => currencyExposure(holdings, lastCloseByTicker, currencyByTicker, fx),
    [holdings, lastCloseByTicker, currencyByTicker, fx],
  );
  const values = useMemo(
    () => valueByTicker(holdings, lastCloseByTicker),
    [holdings, lastCloseByTicker],
  );
  const breakdown = useMemo(
    () => sectorBreakdown(holdings, values, sectorByTicker),
    [holdings, values, sectorByTicker],
  );
  const portfolioHhi = useMemo(() => hhi(breakdown.map((b) => b.weight)), [breakdown]);
  const wZ = useMemo(
    () => avgWeightedZ(holdings, values, zByTicker),
    [holdings, values, zByTicker],
  );

  const [lazyCorr, setLazyCorr] = useState<Correlations | null>(null);
  useEffect(() => {
    if (holdings.length < 2) return;
    let cancelled = false;
    fetch("/data/correlations.json")
      .then((r) => r.json() as Promise<Correlations>)
      .then((c) => {
        if (!cancelled) setLazyCorr(c);
      })
      .catch(() => { /* silent — stat stays null */ });
    return () => {
      cancelled = true;
    };
  }, [holdings.length]);
  const xCorr = useMemo(
    () => (lazyCorr && holdings.length >= 2 ? avgCrossCorrelation(holdings, lazyCorr) : null),
    [holdings, lazyCorr],
  );

  const dayRet = useMemo(
    () => portfolioReturn(holdings, lastCloseByTicker, return1dByTicker),
    [holdings, lastCloseByTicker, return1dByTicker],
  );
  const monthRet = useMemo(
    () => portfolioReturn(holdings, lastCloseByTicker, return1mByTicker),
    [holdings, lastCloseByTicker, return1mByTicker],
  );
  const yearRet = useMemo(
    () => portfolioReturn(holdings, lastCloseByTicker, return1yByTicker),
    [holdings, lastCloseByTicker, return1yByTicker],
  );

  const hasPortfolio = hasHydrated && holdings.length > 0;
  const topSector = breakdown[0];

  return (
    <div className="flex min-h-screen w-screen flex-col bg-bg pb-16">
      <AppHeader
        metadata={metadata}
        universeCount={tickerProfiles.length}
        sectorCount={sectorCount}
        lastUpdate={lastUpdate}
      />

      <StockSearchBar tickerProfiles={tickerProfiles} />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
      >
        <HeroValue
          total={total}
          dayRet={dayRet}
          monthRet={monthRet}
          yearRet={yearRet}
          hhi={portfolioHhi}
          topSector={topSector ?? null}
          hasPortfolio={hasPortfolio}
          holdingCount={holdings.length}
          universeCount={tickerProfiles.length}
          asOfDate={formatAsOf(metadata.data_version)}
          asOfIso={metadata.data_version}
        />
      </motion.div>

      {/* Composition lives outside the lens system — it's the
          foundation. Every lens below is an *analysis* of this. */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: EASE_OUT_STRONG }}
        className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-8 sm:py-16"
      >
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
            Composition
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
            {hasPortfolio ? "by value" : "by market cap"}
          </span>
        </div>
        <div className="flex flex-wrap gap-10">
          <div className="w-full max-w-md">
            <CompositionDonut
              details={details}
              brandColorByTicker={brandColorByTicker}
              currencyByTicker={currencyByTicker}
              fx={fx}
            />
          </div>
          <div className="min-w-[280px] flex-1">
            <HoldingsCard
              tickerProfiles={tickerProfiles}
              lastCloseByTicker={lastCloseByTicker}
              currencyByTicker={currencyByTicker}
              fx={fx}
            />
          </div>
        </div>
      </motion.section>

      {/* Transition cue between foundation and analyses. */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3, ease: EASE_OUT_STRONG }}
        className="mx-auto -mt-2 mb-2 max-w-6xl px-4 text-[11px] uppercase tracking-[0.12em] text-text-tertiary sm:px-8"
      >
        Through the lens of —
      </motion.p>

      <LensPicker active={lens} onSelect={setLens} />

      <LensView active={lens} direction={direction}>
        {lens === "performance" ? (
          <PerformanceLens
            currencyByTicker={currencyByTicker}
            brandColorByTicker={brandColorByTicker}
          />
        ) : lens === "risk" ? (
          <RiskLens
            lastCloseByTicker={lastCloseByTicker}
            currencyByTicker={currencyByTicker}
            fx={fx}
            sectorByTicker={sectorByTicker}
            hasPortfolio={hasPortfolio}
            wZ={wZ}
            xCorr={xCorr}
            portfolioHhi={portfolioHhi}
            holdings={holdings}
            universeCount={tickerProfiles.length}
            ccyExposure={ccyExposure}
          />
        ) : lens === "valuation" ? (
          <ValuationLens details={details} brandColorByTicker={brandColorByTicker} />
        ) : lens === "movement" ? (
          <MovementLens details={details} />
        ) : lens === "network" ? (
          <NetworkLens
            hasPortfolio={hasPortfolio}
            tickers={holdings.map((h) => h.ticker)}
          />
        ) : lens === "market" ? (
          <MarketLens marketGex={marketGex} />
        ) : (
          <InnovationLens />
        )}
      </LensView>
    </div>
  );
}

// -------------- lens panels --------------

function LensWrap({
  label,
  caption,
  children,
  maxWidth = "max-w-6xl",
}: {
  label: string;
  caption?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <section className={`mx-auto w-full px-4 py-10 sm:px-8 sm:py-14 ${maxWidth}`}>
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
          {label}
        </h2>
        {caption ? (
          <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
            {caption}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PerformanceLens({
  currencyByTicker,
  brandColorByTicker,
}: {
  currencyByTicker: Record<string, string>;
  brandColorByTicker: Record<string, string>;
}) {
  return (
    <LensWrap label="Performance" caption="current basket, held back through time" maxWidth="max-w-4xl">
      <PerformanceCard
        currencyByTicker={currencyByTicker}
        brandColorByTicker={brandColorByTicker}
      />
    </LensWrap>
  );
}

function RiskLens({
  lastCloseByTicker,
  currencyByTicker,
  fx,
  sectorByTicker,
  hasPortfolio,
  wZ,
  xCorr,
  portfolioHhi,
  holdings,
  universeCount,
  ccyExposure,
}: {
  lastCloseByTicker: Record<string, number>;
  currencyByTicker: Record<string, string>;
  fx: Fx | null;
  sectorByTicker: Record<string, string | null>;
  hasPortfolio: boolean;
  wZ: number | null;
  xCorr: number | null;
  portfolioHhi: number;
  holdings: { ticker: string; shares: number }[];
  universeCount: number;
  ccyExposure: { currency: string; weight: number }[];
}) {
  return (
    <LensWrap label="Risk" caption="market · sector · idiosyncratic" maxWidth="max-w-4xl">
      <div className="flex flex-col gap-16">
        <RiskDecompositionCard
          lastCloseByTicker={lastCloseByTicker}
          currencyByTicker={currencyByTicker}
          fx={fx}
        />
        <SectorExposureCard
          lastCloseByTicker={lastCloseByTicker}
          sectorByTicker={sectorByTicker}
          useSectorColors
        />
        <div>
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.10em] text-text-secondary">
            Concentration & diversification
          </h3>
          <div className="grid grid-cols-2 divide-x divide-y divide-[color:var(--hairline-faint)] sm:grid-cols-4 sm:divide-y-0">
            <Stat
              label="Avg z (weighted)"
              value={hasPortfolio ? formatZ(wZ) : "—"}
              tone={toneFor(wZ ?? null)}
              hint="own historical P/E"
            />
            <Stat
              label="Avg correlation"
              value={
                hasPortfolio
                  ? xCorr === null
                    ? "—"
                    : (xCorr > 0 ? "+" : "") + xCorr.toFixed(2)
                  : "—"
              }
              hint={xCorr === null ? "≥ 2 holdings needed" : "lower = more diversified"}
            />
            <Stat
              label="HHI concentration"
              value={hasPortfolio ? portfolioHhi.toFixed(2) : "—"}
              hint={hasPortfolio ? "0 broad · 1 concentrated" : "no holdings"}
            />
            <Stat
              label="Universe coverage"
              value={hasPortfolio ? `${holdings.length} / ${universeCount}` : `0 / ${universeCount}`}
              hint={
                hasPortfolio
                  ? `${formatPct(holdings.length / universeCount, { digits: 0 })} of universe`
                  : "add positions"
              }
            />
          </div>
          {hasPortfolio && ccyExposure.length > 0 ? (
            <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-t border-[color:var(--hairline-faint)] px-6 pt-4 tabular-nums">
              <SectionLabel className="mr-2">Currency mix</SectionLabel>
              {ccyExposure.map((c, i) => (
                <span key={c.currency} className="inline-flex items-baseline gap-2">
                  {i > 0 ? (
                    <span aria-hidden className="text-text-tertiary">·</span>
                  ) : null}
                  <span className="text-[13px] font-semibold text-text-primary md:text-[14px]">
                    {c.currency}
                  </span>
                  <span className="text-[13px] tabular-nums text-text-primary md:text-[14px]">
                    {formatPct(c.weight, { digits: 0 })}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </LensWrap>
  );
}

function ValuationLens({
  details,
  brandColorByTicker,
}: {
  details: DetailMap;
  brandColorByTicker: Record<string, string>;
}) {
  return (
    <LensWrap label="Valuation" caption="P/E z-score vs own history">
      <ZScoreStripCard details={details} brandColorByTicker={brandColorByTicker} />
    </LensWrap>
  );
}

function MovementLens({ details }: { details: DetailMap }) {
  return (
    <LensWrap label="Movement" caption="today's flow">
      <TopMoversCard details={details} />
    </LensWrap>
  );
}

function NetworkLens({
  hasPortfolio,
  tickers,
}: {
  hasPortfolio: boolean;
  tickers: string[];
}) {
  return (
    <LensWrap label="Network" caption="252-day correlation window" maxWidth="max-w-4xl">
      <CorrelationHeatmapCard filterTickers={hasPortfolio ? tickers : null} />
    </LensWrap>
  );
}

function MarketLens({ marketGex }: { marketGex: MarketGexData | null }) {
  if (!marketGex) {
    return (
      <LensWrap label="Market" caption="gamma & context" maxWidth="max-w-4xl">
        <p className="text-[14px] text-text-tertiary">
          Market data isn&apos;t loaded right now. Try refreshing in the header
          to pull the latest GEX profile.
        </p>
      </LensWrap>
    );
  }
  return (
    <LensWrap label="Market" caption="SPY gamma exposure profile" maxWidth="max-w-5xl">
      <MarketGex data={marketGex} />
    </LensWrap>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const color =
    tone === "positive"
      ? "text-state-positive"
      : tone === "negative"
        ? "text-state-negative"
        : "text-text-primary";
  return (
    <div className="flex flex-col justify-center px-6 py-4">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </span>
      <span
        className={
          "mt-2 text-[24px] font-light leading-tight tabular-nums md:text-[32px] " + color
        }
      >
        {value}
      </span>
      {hint ? (
        <span className="mt-1 text-[12px] tabular-nums text-text-tertiary md:text-[13px]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
