"use client";

import { motion, useReducedMotion } from "motion/react";

import { formatLocalMoney, formatPct, symbolFor, toneFor } from "@/lib/format";
import { EASE_OUT_STRONG, useAnimatedNumber } from "@/lib/motion";

import { FreshnessBadge } from "./FreshnessBadge";
import { HeroBackdrop } from "./HeroBackdrop";

type Props = {
  total: number;
  dayRet: number | null;
  monthRet: number | null;
  yearRet: number | null;
  hhi: number;
  topSector: { sector: string; weight: number } | null;
  hasPortfolio: boolean;
  holdingCount: number;
  universeCount: number;
  asOfDate: string;
  /** Raw yyyy-mm-dd pull date, for the live freshness signal. */
  asOfIso?: string;
};

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-state-positive",
  negative: "text-state-negative",
  neutral: "text-text-secondary",
};

export function HeroValue({
  total,
  dayRet,
  monthRet,
  yearRet,
  hhi,
  topSector,
  hasPortfolio,
  holdingCount,
  universeCount,
  asOfDate,
  asOfIso,
}: Props) {
  const dayTone = toneFor(dayRet);

  return (
    <section className="relative isolate overflow-hidden px-8 pb-20 pt-28">
      <HeroBackdrop />

      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary"
        >
          <span>Portfolio</span>
          <Dot />
          <span className="text-text-tertiary">As of {asOfDate}</span>
          {asOfIso ? (
            <>
              <Dot />
              <span className="font-normal normal-case tracking-normal">
                <FreshnessBadge asOf={asOfIso} variant="inline" />
              </span>
            </>
          ) : null}
        </motion.div>

        <div className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          {hasPortfolio ? (
            <span className="inline-flex items-baseline">
              <span className="mr-3 text-[44px] font-light leading-none text-text-secondary">
                {symbolFor("EUR")}
              </span>
              <AnimatedAmount total={total} />
            </span>
          ) : (
            <span className="display-lg md:display-xl text-text-secondary">—</span>
          )}

          {hasPortfolio && dayRet !== null ? (
            <SignAwareChip value={dayRet} tone={dayTone} suffix=" today" />
          ) : null}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT_STRONG }}
          className="mt-8 max-w-2xl text-[15px] leading-relaxed text-text-secondary"
        >
          {hasPortfolio
            ? `Across ${holdingCount} ${holdingCount === 1 ? "holding" : "holdings"}`
            : "Build a portfolio to track exposure, risk, and concentration"}
          <span className="mx-2 text-text-tertiary">·</span>
          <span className="text-text-tertiary">
            from a universe of {universeCount} tickers
          </span>
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35, ease: EASE_OUT_STRONG }}
          className="mt-12 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-[color:var(--hairline-faint)] pt-6 text-[13px] tabular-nums"
        >
          <InlineStat label="1D" value={hasPortfolio ? formatPct(dayRet, { sign: true }) : "—"} />
          <InlineStat label="1M" value={hasPortfolio ? formatPct(monthRet, { sign: true }) : "—"} />
          <InlineStat label="1Y" value={hasPortfolio ? formatPct(yearRet, { sign: true }) : "—"} />
          <InlineStat label="Concentration" value={hasPortfolio ? hhi.toFixed(2) : "—"} />
          {hasPortfolio && topSector ? (
            <InlineStat label="Top sector" value={topSector.sector} />
          ) : null}
        </motion.div>
      </div>
    </section>
  );
}

function AnimatedAmount({ total }: { total: number }) {
  const reduced = useReducedMotion();
  const useCompact = Math.abs(total) >= 1e9;

  const display = useAnimatedNumber(total, {
    duration: reduced ? 0 : 0.9,
    decimals: 2,
  });

  if (useCompact) {
    const formatted = formatLocalMoney(total, "EUR", { compact: true });
    const sym = symbolFor("EUR");
    const stripped = formatted.startsWith(sym) ? formatted.slice(sym.length) : formatted;
    return (
      <motion.span
        key={stripped}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_STRONG }}
        className="display-lg md:display-xl tabular-nums"
      >
        {stripped}
      </motion.span>
    );
  }

  return (
    <motion.span
      className="display-lg md:display-xl tabular-nums"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE_OUT_STRONG }}
    >
      {display}
    </motion.span>
  );
}

function SignAwareChip({
  value,
  tone,
  suffix,
}: {
  value: number;
  tone: "positive" | "negative" | "neutral";
  suffix?: string;
}) {
  const text = formatPct(value, { sign: true });
  return (
    <motion.span
      key={tone}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: EASE_OUT_STRONG }}
      className={"text-[15px] font-medium tabular-nums " + TONE[tone]}
    >
      {text}
      {suffix}
    </motion.span>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </span>
      <span className="text-text-primary tabular-nums">{value}</span>
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-text-tertiary">
      ·
    </span>
  );
}
