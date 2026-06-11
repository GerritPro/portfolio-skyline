"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { colors, rgba } from "@/lib/design-tokens";
import type { DetailMap } from "@/lib/detail-data";
import { useHoldingsStore } from "@/lib/holdings";

import { Watermark } from "../Watermark";

type Props = {
  details: DetailMap;
  brandColorByTicker?: Record<string, string>;
};

const MIN_Z = -3;
const MAX_Z = +3;
const MIN_DX_FRACTION = 0.06;
const ROW_OFFSET_PX = 36;
const BASE_LABEL_OFFSET_PX = 14;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function assignLabelRows(
  points: { ticker: string; z: number }[],
): Record<string, number> {
  const sorted = [...points].sort((a, b) => a.z - b.z);
  const rowLastX: number[] = [];
  const row: Record<string, number> = {};
  for (const p of sorted) {
    const x = (p.z - MIN_Z) / (MAX_Z - MIN_Z);
    let r = 0;
    while (rowLastX[r] !== undefined && x - rowLastX[r] < MIN_DX_FRACTION) r++;
    rowLastX[r] = x;
    row[p.ticker] = r;
  }
  return row;
}

function interpretZ(z: number): string {
  if (z <= -2) return "Extreme cheap vs own history";
  if (z <= -1) return "Below average — moderate discount";
  if (z < 1) return "Around its own typical valuation";
  if (z < 2) return "Above average but not extreme";
  return "Extreme expensive vs own history";
}

export function ZScoreStripCard({ details, brandColorByTicker }: Props) {
  const router = useRouter();
  const openPanelFor = (ticker: string) => router.push(`/stock/${ticker}`);
  const [hovered, setHovered] = useState<string | null>(null);
  const holdings = useHoldingsStore((s) => s.holdings);
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const portfolioMode = hasHydrated && holdings.length > 0;

  const { points, notProfitable } = useMemo(() => {
    const profitable: { ticker: string; z: number; pe: number; mean: number }[] = [];
    const notProfit: string[] = [];
    if (!portfolioMode) return { points: profitable, notProfitable: notProfit };
    const list = holdings
      .map((h) => details[h.ticker])
      .filter((d): d is NonNullable<typeof d> => !!d);
    for (const d of list) {
      if (d.currentPe === null || !Number.isFinite(d.currentPe)) continue;
      if (d.currentPe < 0) {
        notProfit.push(d.ticker);
        continue;
      }
      if (d.zScore === 0) continue;
      profitable.push({
        ticker: d.ticker,
        z: clamp(d.zScore, MIN_Z, MAX_Z),
        pe: d.currentPe,
        mean: d.ownMean,
      });
    }
    return { points: profitable, notProfitable: notProfit };
  }, [details, holdings, portfolioMode]);

  const labelRow = useMemo(() => assignLabelRows(points), [points]);

  return points.length === 0 ? (
    <p className="text-[13px] text-text-tertiary">
      {portfolioMode
        ? "Your holdings don't have enough P/E history yet — try adding US-listed profitable names."
        : "Add holdings to see how their P/E sits vs each stock's own 5-year history."}
    </p>
  ) : (
    <div className="relative flex flex-col gap-6">
      <p className="mb-2 max-w-3xl text-[14px] leading-relaxed text-text-secondary md:text-[15px]">
        Each stock&apos;s current P/E vs its own 5-year history. Left = cheaper than usual, right = more expensive.
      </p>

      <div className="relative h-[320px]">
        {/* Subtle background tint: green-tinted on the left (cheap), red on the right. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-6 bottom-12 rounded"
          style={{
            background: `linear-gradient(90deg, ${rgba(colors.statePositive, 0.08)} 0%, transparent 45%, transparent 55%, ${rgba(colors.stateNegative, 0.08)} 100%)`,
          }}
        />

        {/* Tick lines: ±2σ subtle, ±1σ stronger (the "moderate" boundaries),
            0σ strongest (the centre). */}
        {[-2, 2].map((tick) => {
          const left = ((tick - MIN_Z) / (MAX_Z - MIN_Z)) * 100;
          return (
            <div
              key={tick}
              aria-hidden
              className="pointer-events-none absolute top-6 bottom-12 w-px"
              style={{
                left: `calc(24px + (100% - 48px) * ${left / 100})`,
                background: "var(--text-tertiary)",
                opacity: 0.15,
              }}
            />
          );
        })}
        {[-1, 1].map((tick) => {
          const left = ((tick - MIN_Z) / (MAX_Z - MIN_Z)) * 100;
          return (
            <div
              key={tick}
              aria-hidden
              className="pointer-events-none absolute top-6 bottom-12 w-px"
              style={{
                left: `calc(24px + (100% - 48px) * ${left / 100})`,
                background: "var(--text-tertiary)",
                opacity: 0.25,
              }}
            />
          );
        })}
        <div
          aria-hidden
          className="pointer-events-none absolute top-6 bottom-12 left-1/2 w-px"
          style={{ background: "var(--text-tertiary)", opacity: 0.4 }}
        />

        {/* Central axis line */}
        <div
          className="pointer-events-none absolute inset-x-6 top-1/2 h-px"
          style={{
            background: `linear-gradient(90deg, ${rgba(colors.statePositive, 0.45)} 0%, ${rgba(
              colors.divider,
              0.7,
            )} 50%, ${rgba(colors.stateNegative, 0.45)} 100%)`,
          }}
        />

        {/* Extreme zone labels at -2σ and +2σ */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 text-[11px] uppercase tracking-[0.10em] text-text-tertiary md:text-[12px]"
          style={{
            left: `calc(24px + (100% - 48px) * ${((-2 - MIN_Z) / (MAX_Z - MIN_Z))})`,
            transform: "translateX(-50%)",
          }}
        >
          extreme cheap
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 text-[11px] uppercase tracking-[0.10em] text-text-tertiary md:text-[12px]"
          style={{
            left: `calc(24px + (100% - 48px) * ${((2 - MIN_Z) / (MAX_Z - MIN_Z))})`,
            transform: "translateX(-50%)",
          }}
        >
          extreme expensive
        </span>

        {points.map((p) => {
          const x = ((p.z - MIN_Z) / (MAX_Z - MIN_Z)) * 100;
          const row = labelRow[p.ticker] ?? 0;
          const dotColor = brandColorByTicker?.[p.ticker] ?? colors.chartNeutral;
          const detail = details[p.ticker];
          const peText = `${p.pe.toFixed(1)}x`;
          const isHovered = hovered === p.ticker;
          return (
            <div
              key={p.ticker}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `calc(24px + (100% - 48px) * ${x / 100})` }}
            >
              <button
                type="button"
                onClick={() => openPanelFor(p.ticker)}
                onMouseEnter={() => setHovered(p.ticker)}
                onMouseLeave={() => setHovered(null)}
                className="group relative transition-transform duration-200 ease-out hover:scale-[1.5]"
                aria-label={`${p.ticker}: ${p.z.toFixed(2)} sigma`}
              >
                <span
                  aria-hidden
                  className="block h-4 w-4 rounded-full transition-shadow"
                  style={{
                    backgroundColor: dotColor,
                    boxShadow: "0 0 0 2px var(--bg-primary), 0 1px 3px rgba(0,0,0,0.12)",
                  }}
                />
              </button>
              <div
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center"
                style={{ top: `calc(100% + ${BASE_LABEL_OFFSET_PX + row * ROW_OFFSET_PX}px)` }}
              >
                <div className="text-[13px] font-semibold tracking-tight text-text-primary md:text-[14px]">
                  {p.ticker}
                </div>
                <div className="mt-0.5 text-[14px] tabular-nums text-text-primary md:text-[16px]">{peText}</div>
              </div>
              {isHovered && detail ? (
                <div
                  className="pointer-events-none absolute z-20 w-[200px] rounded-lg border border-[color:var(--hairline-soft)] px-3 py-2 backdrop-blur-md"
                  style={{
                    background: "rgba(255, 255, 255, 0.92)",
                    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)",
                    left: x > 60 ? "auto" : "calc(100% + 12px)",
                    right: x > 60 ? "calc(100% + 12px)" : "auto",
                    top: "-8px",
                  }}
                >
                  <div className="text-[12px] uppercase tracking-[0.08em] text-text-tertiary">
                    {p.ticker} · {detail.name}
                  </div>
                  <div className="mt-1.5 flex justify-between text-[13px] tabular-nums">
                    <span className="text-text-tertiary">Current P/E</span>
                    <span className="text-text-primary">{p.pe.toFixed(1)}x</span>
                  </div>
                  <div className="flex justify-between text-[13px] tabular-nums">
                    <span className="text-text-tertiary">5Y average P/E</span>
                    <span className="text-text-primary">{p.mean.toFixed(1)}x</span>
                  </div>
                  <div className="flex justify-between text-[13px] tabular-nums">
                    <span className="text-text-tertiary">Z-score</span>
                    <span className="text-text-primary">{p.z >= 0 ? "+" : ""}{p.z.toFixed(2)}σ</span>
                  </div>
                  <div className="mt-1.5 text-[12px] text-text-tertiary">{interpretZ(p.z)}</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-text-tertiary">
        <span className="text-[13px] tabular-nums md:text-[14px]">−3σ</span>
        <span className="text-[12px] tracking-[0.04em] md:text-[13px]">cheap · vs own history · expensive</span>
        <span className="text-[13px] tabular-nums md:text-[14px]">+3σ</span>
      </div>

      {notProfitable.length > 0 ? (
        <div className="text-[12px] text-text-tertiary md:text-[13px]">
          Not profitable (excluded from P/E z-score): {notProfitable.join(", ")}
        </div>
      ) : null}
      <Watermark className="absolute right-2 -bottom-1" />
    </div>
  );
}
