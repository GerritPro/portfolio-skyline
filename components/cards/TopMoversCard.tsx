"use client";

import { useMemo } from "react";

import { useRouter } from "next/navigation";

import { colors } from "@/lib/design-tokens";
import type { DetailMap } from "@/lib/detail-data";
import { formatPct, toneFor } from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";

import { Watermark } from "../Watermark";

type Props = {
  details: DetailMap;
};

export function TopMoversCard({ details }: Props) {
  const router = useRouter();
  const openPanelFor = (ticker: string) => router.push(`/stock/${ticker}`);
  const holdings = useHoldingsStore((s) => s.holdings);
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);

  const sorted = useMemo(() => {
    const portfolioMode = hasHydrated && holdings.length > 0;
    const arr = portfolioMode
      ? holdings.map((h) => details[h.ticker]).filter((d): d is NonNullable<typeof d> => !!d && d.return1d !== null)
      : Object.values(details).filter((d) => d.return1d !== null);
    arr.sort((a, b) => (b.return1d ?? 0) - (a.return1d ?? 0));
    return arr;
  }, [details, holdings, hasHydrated]);

  const maxAbs = useMemo(() => {
    let m = 0.005;
    for (const d of sorted) {
      const r = d.return1d;
      if (r !== null && Math.abs(r) > m) m = Math.abs(r);
    }
    return m;
  }, [sorted]);

  if (sorted.length === 0) {
    return (
      <p className="text-[13px] text-text-tertiary">
        Add a holding to see how your portfolio is moving today.
      </p>
    );
  }

  return (
    <div className="relative">
    <ul className="flex flex-col gap-3">
        {sorted.map((d) => {
          const r = d.return1d ?? 0;
          const tone = toneFor(r);
          const pct = Math.min(1, Math.abs(r) / maxAbs);
          return (
            <li
              key={d.ticker}
              onClick={() => openPanelFor(d.ticker)}
              className="group grid cursor-pointer grid-cols-[60px_1fr_64px] items-center gap-3"
            >
              <span className="text-[13px] font-semibold tracking-tight text-text-primary">
                {d.ticker}
              </span>
              <div className="relative h-[8px] rounded-full bg-bg-soft">
                <div className="absolute inset-y-0 left-1/2 w-px bg-divider" />
                {tone === "positive" ? (
                  <div
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: "50%",
                      width: `${pct * 50}%`,
                      backgroundColor: colors.statePositive,
                    }}
                  />
                ) : tone === "negative" ? (
                  <div
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      right: "50%",
                      width: `${pct * 50}%`,
                      backgroundColor: colors.stateNegative,
                    }}
                  />
                ) : null}
              </div>
              <span
                className={
                  "text-right text-[13px] font-medium tabular-nums " +
                  (tone === "positive"
                    ? "text-state-positive"
                    : tone === "negative"
                      ? "text-state-negative"
                      : "text-text-secondary")
                }
              >
                {formatPct(r, { sign: true })}
              </span>
            </li>
          );
        })}
    </ul>
    <Watermark className="absolute right-1 -bottom-5" />
    </div>
  );
}
