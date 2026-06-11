"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { convertToEur, formatLocalMoney, formatPct } from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";

import { AddHoldingModal } from "../AddHoldingModal";
import type { Fx, Profile } from "@/lib/types";

type Props = {
  tickerProfiles: Profile[];
  lastCloseByTicker: Record<string, number>;
  currencyByTicker: Record<string, string>;
  fx: Fx | null;
};

export function HoldingsCard({
  tickerProfiles,
  lastCloseByTicker,
  currencyByTicker,
  fx,
}: Props) {
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const holdings = useHoldingsStore((s) => s.holdings);
  const remove = useHoldingsStore((s) => s.remove);
  const persistEnabled = useHoldingsStore((s) => s.persistEnabled);
  const router = useRouter();
  const openPanelFor = (ticker: string) => router.push(`/stock/${ticker}`);

  const [addOpen, setAddOpen] = useState(false);

  const enriched = useMemo(() => {
    return holdings
      .map((h) => {
        const price = lastCloseByTicker[h.ticker];
        const value = typeof price === "number" ? h.shares * price : 0;
        const currency = (currencyByTicker[h.ticker] ?? "USD").toUpperCase();
        const eurValue = convertToEur(value, currency, fx);
        return {
          ...h,
          value,
          price: price ?? null,
          currency,
          eurValue,
        };
      })
      .sort((a, b) => (b.eurValue ?? 0) - (a.eurValue ?? 0));
  }, [holdings, lastCloseByTicker, currencyByTicker, fx]);

  const totalEur = enriched.reduce((s, x) => s + (x.eurValue ?? 0), 0);

  return (
    <>
      <div className="flex flex-col">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Holdings
          </h3>
          <div className="flex items-center gap-2">
            {!persistEnabled && hasHydrated ? (
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
                session
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              aria-label="Add holding"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-tertiary transition-[colors,transform] duration-150 ease-out hover:scale-[1.05] hover:bg-[color:var(--accent-blue-soft)] hover:text-accent-blue active:scale-[0.95]"
              style={{ transitionTimingFunction: "var(--ease-out-strong, cubic-bezier(0.23, 1, 0.32, 1))" }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M6 1V11 M1 6H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        {!hasHydrated ? (
          <p className="caption">Loading…</p>
        ) : enriched.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <p className="title">Empty portfolio</p>
            <p className="caption">
              Click <span className="font-medium text-text-primary">+</span> to add a holding.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--hairline-faint)]">
            {enriched.map((h) => {
              const weight = totalEur > 0 ? (h.eurValue ?? 0) / totalEur : 0;
              return (
                <li
                  key={h.ticker}
                  className="group grid grid-cols-[1fr_92px_44px_20px] items-baseline gap-3 py-3 tabular-nums"
                >
                  <button
                    type="button"
                    onClick={() => openPanelFor(h.ticker)}
                    className="text-left transition-transform duration-150 ease-out active:scale-[0.98]"
                  >
                    <span className="text-[15px] font-semibold tracking-tight text-text-primary">
                      {h.ticker}
                    </span>
                    <span className="ml-2 text-[13px] text-text-secondary">
                      {h.shares} {h.shares === 1 ? "share" : "shares"}
                    </span>
                  </button>
                  <span className="text-right text-[14px] font-medium text-text-primary">
                    <span className="block">{formatLocalMoney(h.value, h.currency, { compact: true })}</span>
                    {h.currency !== "EUR" && h.eurValue !== null ? (
                      <span className="block text-[12px] font-normal text-text-tertiary">
                        ≈ {formatLocalMoney(h.eurValue, "EUR", { compact: true })}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right text-[13px] text-text-secondary">
                    {formatPct(weight, { digits: 0 })}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(h.ticker)}
                    aria-label={`Remove ${h.ticker}`}
                    className="text-text-tertiary opacity-0 transition-opacity hover:text-state-negative group-hover:opacity-100"
                  >
                    <svg width="10" height="10" viewBox="0 0 9 9" aria-hidden>
                      <path d="M1 1L8 8 M8 1L1 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {addOpen ? (
        <AddHoldingModal
          onClose={() => setAddOpen(false)}
          tickerProfiles={tickerProfiles}
        />
      ) : null}
    </>
  );
}
