"use client";

import type { MarketGex } from "@/lib/types";

import { MarketGexChart } from "./MarketGexChart";
import { MarketGexInfoPopover } from "./MarketGexInfoPopover";
import { SectionLabel } from "./SectionLabel";

type Props = {
  data: MarketGex;
};

const NEAR_ZERO = 1e8;

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-state-positive",
  negative: "text-state-negative",
  neutral: "text-text-primary",
};

function tone(v: number): "positive" | "negative" | "neutral" {
  if (v > NEAR_ZERO) return "positive";
  if (v < -NEAR_ZERO) return "negative";
  return "neutral";
}

function formatGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPrice(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `$${p.toFixed(0)}`;
}

function interpret(v: number): string {
  if (v > NEAR_ZERO) {
    return "Dealers sell rallies and buy dips. Expect volatility dampening and mean reversion toward the flip level.";
  }
  if (v < -NEAR_ZERO) {
    return "Dealers buy rallies and sell dips. Expect volatility amplification on directional moves.";
  }
  return "Gamma exposure balanced. Dealer hedging neutral; price action driven by flow rather than mechanical hedging.";
}

export function MarketGex({ data }: Props) {
  const gexTone = tone(data.aggregate_gex);

  return (
    <section className="mx-auto w-full max-w-6xl px-8 py-12">
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
            Market Mechanics
          </h2>
          <MarketGexInfoPopover />
        </div>
        <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary tabular-nums">
          SPY · {data.as_of}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,360px)_1fr]">
        <div className="flex flex-col gap-3">
          <SectionLabel>Aggregate GEX</SectionLabel>
          <div
            className={
              "text-[32px] font-light leading-tight tabular-nums " + TONE[gexTone]
            }
          >
            {formatGex(data.aggregate_gex)}
          </div>
          <p className="text-[14px] leading-relaxed text-text-secondary">
            {interpret(data.aggregate_gex)}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] tabular-nums">
            <Stat label="Flip" value={formatPrice(data.flip_level)} />
            <Bullet />
            <Stat label="Call Wall" value={formatPrice(data.call_wall?.strike)} />
            <Bullet />
            <Stat label="Put Wall" value={formatPrice(data.put_wall?.strike)} />
            <Bullet />
            <Stat label="Spot" value={formatPrice(data.spy_spot)} />
          </div>
        </div>

        <MarketGexChart data={data} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-primary">{value}</span>
    </span>
  );
}

function Bullet() {
  return (
    <span aria-hidden className="text-text-tertiary">
      ·
    </span>
  );
}
