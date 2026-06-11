"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart } from "recharts";

import { Watermark } from "../Watermark";

import { grayByRank } from "@/lib/chart-colors";
import type { DetailMap } from "@/lib/detail-data";
import { convertToEur, formatLocalMoney, formatPct } from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";
import type { Fx } from "@/lib/types";

type Props = {
  details: DetailMap;
  brandColorByTicker?: Record<string, string>;
  /** Per-ticker currency + FX so weights are computed in a single currency
   *  (EUR), matching the Holdings list. Without this, a CNY holding would be
   *  summed as if it were USD and its slice would be ~8× too large. */
  currencyByTicker: Record<string, string>;
  fx: Fx | null;
};

type Slice = {
  ticker: string;
  name: string;
  sector: string | null;
  /** EUR-converted value — the basis for both weights and the centre total. */
  value: number;
};

export function CompositionDonut({
  details,
  brandColorByTicker,
  currencyByTicker,
  fx,
}: Props) {
  const holdings = useHoldingsStore((s) => s.holdings);
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const router = useRouter();
  const openPanelFor = (ticker: string) => router.push(`/stock/${ticker}`);

  const portfolioMode = holdings.length > 0 && hasHydrated;

  const slices: Slice[] = useMemo(() => {
    if (!portfolioMode) return [];
    const out: Slice[] = [];
    for (const h of holdings) {
      const d = details[h.ticker];
      if (!d || d.price === null) continue;
      const local = h.shares * d.price;
      const ccy = (currencyByTicker[h.ticker] ?? "USD").toUpperCase();
      // Convert to EUR so cross-currency weights are comparable. Fall back to
      // the local value only if no rate is available (keeps the slice rather
      // than dropping the holding).
      const value = convertToEur(local, ccy, fx) ?? local;
      out.push({
        ticker: h.ticker,
        name: d.name,
        sector: d.sector,
        value,
      });
    }
    out.sort((a, b) => b.value - a.value);
    return out;
  }, [holdings, details, portfolioMode, currencyByTicker, fx]);

  const total = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);
  const sliceColors = useMemo(
    () => slices.map((s, i) => brandColorByTicker?.[s.ticker] ?? grayByRank(i)),
    [slices, brandColorByTicker],
  );
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);

  if (slices.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <p className="title">No positions yet</p>
          <p className="caption mt-2">Add a holding to see your portfolio composition.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center gap-6 py-4 sm:grid sm:grid-cols-[240px_minmax(0,1fr)] sm:items-center">
        <div className="relative h-[240px] w-[240px]">
          <PieChart width={240} height={240}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="ticker"
              cx={120}
              cy={120}
              innerRadius={76}
              outerRadius={112}
              paddingAngle={1.2}
              stroke="var(--bg-primary)"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(slice) => {
                const payload = (slice as { payload?: { ticker?: string } } | undefined)?.payload;
                const ticker =
                  payload?.ticker ?? (slice as { ticker?: string } | undefined)?.ticker;
                if (typeof ticker === "string") openPanelFor(ticker);
              }}
              onMouseEnter={(slice) => {
                const payload = (slice as { payload?: { ticker?: string } } | undefined)?.payload;
                const ticker =
                  payload?.ticker ?? (slice as { ticker?: string } | undefined)?.ticker;
                if (typeof ticker === "string") setHoveredTicker(ticker);
              }}
              onMouseLeave={() => setHoveredTicker(null)}
            >
              {slices.map((s, i) => (
                <Cell
                  key={s.ticker}
                  fill={sliceColors[i]}
                  cursor="pointer"
                  fillOpacity={hoveredTicker === null || hoveredTicker === s.ticker ? 1 : 0.6}
                  style={{ transition: "fill-opacity 200ms ease-out" }}
                />
              ))}
            </Pie>
          </PieChart>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[18px] font-medium leading-tight tabular-nums text-text-primary">
              {formatLocalMoney(total, "EUR", { compact: true })}
            </span>
            <span className="mt-1 text-[12px] tabular-nums text-text-tertiary">
              {slices.length} {slices.length === 1 ? "position" : "positions"}
            </span>
          </div>
        </div>
        <ul className="flex w-full max-h-[240px] flex-col gap-0.5 overflow-y-auto pr-1">
          {slices.map((s, i) => {
            const pct = total > 0 ? s.value / total : 0;
            return (
              <li
                key={s.ticker}
                onClick={() => openPanelFor(s.ticker)}
                className="group grid cursor-pointer grid-cols-[10px_1fr_auto_44px] items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-bg-soft"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: sliceColors[i] }}
                />
                <span className="text-[13px] font-semibold tracking-tight text-text-primary">
                  {s.ticker}
                </span>
                <span className="text-[12px] tabular-nums text-text-secondary">
                  {formatLocalMoney(s.value, "EUR", { compact: true })}
                </span>
                <span className="text-right text-[13px] font-semibold tabular-nums text-text-primary">
                  {formatPct(pct, { digits: 0 })}
                </span>
              </li>
            );
          })}
        </ul>
        <Watermark className="absolute right-2 bottom-2" />
    </div>
  );
}
