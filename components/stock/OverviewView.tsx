"use client";

import { useMemo } from "react";

import {
  convertToEur,
  formatLocalMoney,
  formatPct,
  toneFor,
} from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";
import type { StockMetadata } from "@/lib/stock-data-loader";
import type { Fx } from "@/lib/types";

import { SectionLabel } from "../SectionLabel";

type Props = {
  metadata: StockMetadata;
  fx?: Fx | null;
};

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-state-positive",
  negative: "text-state-negative",
  neutral: "text-text-primary",
};

export function OverviewView({ metadata, fx }: Props) {
  const holdings = useHoldingsStore((s) => s.holdings);
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const currency = metadata.currency ?? "USD";

  const position = useMemo(() => {
    if (!hasHydrated) return null;
    const h = holdings.find((x) => x.ticker === metadata.ticker);
    if (!h) return null;
    if (metadata.price === null) return { shares: h.shares, value: null as number | null };
    const localValue = h.shares * metadata.price;
    const eur = convertToEur(localValue, currency, fx ?? null);
    return { shares: h.shares, value: localValue, eur };
  }, [holdings, hasHydrated, metadata, currency, fx]);

  // FX note: how many local-currency units per 1 EUR.
  let fxNote: string | null = null;
  if (currency !== "EUR" && currency !== "USD" && fx) {
    const rateLocalToEur = fx.rates[currency];
    if (rateLocalToEur && rateLocalToEur > 0) {
      const eurInLocal = 1 / rateLocalToEur;
      fxNote = `Listed in ${currency} · ${formatLocalMoney(eurInLocal, currency)} = €1`;
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-2 gap-y-6 gap-x-10 sm:grid-cols-4">
          <Stat
            label="Price"
            value={formatLocalMoney(metadata.price, currency)}
          />
          <Stat
            label="Market Cap"
            value={formatLocalMoney(metadata.marketCap, currency, { compact: true })}
          />
          <Stat
            label="1Y Return"
            value={formatPct(metadata.return1y, { sign: true })}
            tone={toneFor(metadata.return1y)}
          />
          <Stat
            label="5Y Return"
            value={formatPct(metadata.return5y, { sign: true })}
            tone={toneFor(metadata.return5y)}
          />
        </div>
        {fxNote ? (
          <div className="mt-2 text-[13px] text-text-tertiary">{fxNote}</div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[14px] tabular-nums">
        <RecentMove label="Today" value={metadata.return1d} />
        <span aria-hidden className="text-text-tertiary">·</span>
        <RecentMove label="1M" value={metadata.return1m} />
        <span aria-hidden className="text-text-tertiary">·</span>
        <RecentMove label="1Y" value={metadata.return1y} />
      </div>

      {position ? (
        <div className="flex flex-col gap-2">
          <SectionLabel>Your Position</SectionLabel>
          <div className="flex items-baseline gap-3 text-[17px] tabular-nums text-text-primary">
            <span className="font-medium">{position.shares}</span>
            <span className="text-text-secondary">
              {position.shares === 1 ? "share" : "shares"}
            </span>
            {position.value !== null ? (
              <>
                <span className="px-1 text-text-tertiary">·</span>
                <span>{formatLocalMoney(position.value, currency, { compact: true })}</span>
                {currency !== "EUR" && position.eur !== null ? (
                  <span className="text-[13px] text-text-tertiary">
                    ≈ {formatLocalMoney(position.eur, "EUR", { compact: true })}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <SectionLabel>About</SectionLabel>
        <p className="text-[14px] leading-relaxed text-text-secondary">
          Company description not yet wired. Will appear here once the pipeline profile schema
          is extended with `longBusinessSummary`.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{label}</SectionLabel>
      <span className={"text-[24px] font-medium tabular-nums " + TONE[tone ?? "neutral"]}>
        {value}
      </span>
    </div>
  );
}

function RecentMove({ label, value }: { label: string; value: number | null }) {
  const tone = toneFor(value);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-text-tertiary">{label}</span>
      <span className={TONE[tone]}>{formatPct(value, { sign: true })}</span>
    </span>
  );
}
