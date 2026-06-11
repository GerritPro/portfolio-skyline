"use client";

import { useEffect, useMemo, useState } from "react";

import { motion, useReducedMotion } from "motion/react";

import { colors } from "@/lib/design-tokens";
import { formatPct } from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";
import { EASE_OUT_STRONG } from "@/lib/motion";
import { eurValueByTicker, decomposeRisk } from "@/lib/portfolio-stats";
import type { Fx, RiskFactors } from "@/lib/types";

import { AnimatedBar } from "../AnimatedBar";

const TRADING_DAYS = 252;

const COMPONENT_COLORS = {
  market: colors.accentBlue,
  sector: colors.statePositive,
  idio: colors.textTertiary,
} as const;

type Props = {
  lastCloseByTicker: Record<string, number>;
  currencyByTicker: Record<string, string>;
  fx: Fx | null;
};

export function RiskDecompositionCard({
  lastCloseByTicker,
  currencyByTicker,
  fx,
}: Props) {
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const holdings = useHoldingsStore((s) => s.holdings);

  // Lazy fetch: keeps SSR payload small. ~50KB JSON, only loaded when the
  // user actually has a portfolio.
  const [factors, setFactors] = useState<RiskFactors | null>(null);
  const hasPortfolio = hasHydrated && holdings.length > 0;
  useEffect(() => {
    if (!hasPortfolio) return;
    let cancelled = false;
    fetch("/data/risk_factors.json")
      .then((r) => r.json() as Promise<RiskFactors>)
      .then((f) => {
        if (!cancelled) setFactors(f);
      })
      .catch(() => {
        /* silent — card stays in skeleton */
      });
    return () => {
      cancelled = true;
    };
  }, [hasPortfolio]);

  const decomp = useMemo(() => {
    if (!hasPortfolio || !factors) return null;
    const values = eurValueByTicker(holdings, lastCloseByTicker, currencyByTicker, fx);
    return decomposeRisk(holdings, values, factors);
  }, [hasPortfolio, factors, holdings, lastCloseByTicker, currencyByTicker, fx]);

  if (!hasPortfolio) {
    return (
      <p className="text-[13px] text-text-tertiary">
        Add holdings to see how market, sector, and stock-specific risk combine in your portfolio.
      </p>
    );
  }

  if (!decomp) {
    return (
      <div className="h-[140px] animate-pulse rounded-2xl bg-bg-soft" aria-hidden />
    );
  }

  const dailyVolPct = decomp.totalVol;
  const annualVolPct = decomp.totalVol * Math.sqrt(TRADING_DAYS);

  // Top systematic contributors (market + sector variance, descending).
  const contributors = [...decomp.byTicker]
    .map((b) => ({
      ...b,
      systematic: Math.max(0, b.marketContrib + b.sectorContrib),
    }))
    .sort((a, b) => b.systematic - a.systematic)
    .slice(0, 5);

  const totalVar = Math.max(1e-12, decomp.totalVol * decomp.totalVol);

  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
        <Metric
          label="Portfolio β"
          value={decomp.portfolioBeta.toFixed(2)}
          hint="vs equal-weighted universe"
        />
        <Metric
          label="Daily vol"
          value={formatPct(dailyVolPct, { digits: 2 })}
          hint="model-implied σ"
        />
        <Metric
          label="Annual vol"
          value={formatPct(annualVolPct, { digits: 1 })}
          hint={`σ · √${TRADING_DAYS}`}
        />
        <Metric
          label="Idiosyncratic share"
          value={formatPct(decomp.idioShare, { digits: 0 })}
          hint={
            decomp.missing > 0
              ? `${decomp.covered} of ${decomp.covered + decomp.missing} holdings modelled`
              : "stock-specific risk"
          }
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
          <span>Variance decomposition</span>
          <span className="tabular-nums">total = 100%</span>
        </div>
        <StackedBar
          segments={[
            { label: "Market", value: decomp.marketShare, color: COMPONENT_COLORS.market },
            { label: "Sector", value: decomp.sectorShare, color: COMPONENT_COLORS.sector },
            { label: "Idio.",  value: decomp.idioShare,   color: COMPONENT_COLORS.idio },
          ]}
        />
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[12px] text-text-secondary">
          <Legend color={COMPONENT_COLORS.market} label="Market" pct={decomp.marketShare} />
          <Legend color={COMPONENT_COLORS.sector} label="Sector tilt" pct={decomp.sectorShare} />
          <Legend color={COMPONENT_COLORS.idio} label="Idiosyncratic" pct={decomp.idioShare} />
        </div>
      </div>

      {contributors.length > 0 ? (
        <div>
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Top systematic risk contributors
          </h3>
          <ContributorList>
            {contributors.map((c) => {
              const share = c.systematic / totalVar;
              return (
                <motion.li
                  key={c.ticker}
                  className="flex flex-col gap-1.5"
                  variants={ROW_VARIANTS}
                  transition={{ duration: 0.4, ease: EASE_OUT_STRONG }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-baseline gap-3">
                      <span className="text-[13px] font-semibold text-text-primary tabular-nums">
                        {c.ticker}
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.06em] text-text-tertiary">
                        β {c.betaMarket.toFixed(2)} · w {formatPct(c.weight, { digits: 0 })}
                      </span>
                    </div>
                    <span className="text-[13px] tabular-nums text-text-primary">
                      {formatPct(share, { digits: 0 })}
                    </span>
                  </div>
                  <AnimatedBar
                    value={share}
                    color={colors.accentBlue}
                    height={4}
                    ariaLabel={`${c.ticker} systematic risk share`}
                  />
                </motion.li>
              );
            })}
          </ContributorList>
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </span>
      <span className="text-[28px] font-light tracking-tight text-text-primary tabular-nums">
        {value}
      </span>
      {hint ? (
        <span className="text-[11px] text-text-tertiary">{hint}</span>
      ) : null}
    </div>
  );
}

function StackedBar({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const reduced = useReducedMotion();
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) {
    return <div className="h-[10px] w-full rounded-full bg-bg-soft" aria-hidden />;
  }
  // Reveal the whole bar left → right via clip-path. Individual segment
  // widths still tween in CSS for smooth proportion changes later.
  return (
    <motion.div
      className="flex h-[10px] w-full overflow-hidden rounded-full bg-bg-soft"
      initial={{ clipPath: reduced ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }}
      animate={{ clipPath: "inset(0 0 0 0)" }}
      transition={{ duration: 0.7, ease: EASE_OUT_STRONG }}
    >
      {segments.map((seg) => {
        const widthPct = (Math.max(0, seg.value) / total) * 100;
        if (widthPct <= 0) return null;
        return (
          <div
            key={seg.label}
            className="h-full"
            style={{
              width: `${widthPct}%`,
              backgroundColor: seg.color,
              transition: "width 400ms var(--ease-out-strong, ease-out)",
            }}
            aria-label={`${seg.label}: ${widthPct.toFixed(0)}%`}
          />
        );
      })}
    </motion.div>
  );
}

function Legend({
  color,
  label,
  pct,
}: {
  color: string;
  label: string;
  pct: number;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-[8px] w-[8px] rounded-full"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
      <span className="tabular-nums text-text-primary">
        {formatPct(pct, { digits: 0 })}
      </span>
    </span>
  );
}

const ROW_VARIANTS = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
};

function ContributorList({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.ul
      className="flex flex-col gap-3"
      initial={reduced ? "visible" : "hidden"}
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.05 } },
      }}
    >
      {children}
    </motion.ul>
  );
}
