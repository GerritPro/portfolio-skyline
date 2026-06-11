"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  fetchInsider,
  getCachedInsider,
  subscribeInsiderCache,
} from "@/lib/insider-fetch";

import { SectionLabel } from "../SectionLabel";

import { InsiderInfoPopover } from "./InsiderInfoPopover";
import { InsiderTimelineChart } from "./InsiderTimelineChart";
import { InsiderTransactionList } from "./InsiderTransactionList";

type Props = {
  ticker: string;
};

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-state-positive",
  negative: "text-state-negative",
  neutral: "text-text-primary",
};

function toneFor(v: number): "positive" | "negative" | "neutral" {
  if (v > 0) return "positive";
  if (v < 0) return "negative";
  return "neutral";
}

function formatMoneyWithSign(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function InsiderActivity({ ticker }: Props) {
  const getSnapshot = useCallback(
    () => getCachedInsider(ticker) ?? null,
    [ticker],
  );
  const data = useSyncExternalStore(subscribeInsiderCache, getSnapshot, () => null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getCachedInsider(ticker)) return;
    let cancelled = false;
    fetchInsider(ticker).catch((e: Error) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (error) {
    return (
      <div className="text-[13px] text-state-negative">
        Failed to load insider data: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-[120px] w-full max-w-md animate-pulse rounded bg-bg-soft" />
        <div className="h-[260px] w-full animate-pulse rounded bg-bg-soft" />
      </div>
    );
  }

  const net = data.summary.net_buy_sell_90d;
  const netTone = toneFor(net);
  const hasTransactions = data.transactions.some((t) => t.type !== "A");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-baseline gap-3">
        <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          Ownership <span className="px-1.5 text-text-tertiary">›</span> Insider Activity
        </div>
        <InsiderInfoPopover />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Net Insider Activity (90d)</SectionLabel>
        <div
          className={
            "text-[40px] font-light leading-tight tabular-nums " + TONE[netTone]
          }
        >
          {formatMoneyWithSign(net)}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] tabular-nums">
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-text-tertiary">Insiders active</span>
            <span className="text-text-primary">{data.summary.insider_count_90d}</span>
          </span>
          <span aria-hidden className="text-text-tertiary">·</span>
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-text-tertiary">Latest</span>
            <span className="text-text-primary">{formatDate(data.summary.latest_activity)}</span>
          </span>
          {data.summary.cluster_signal ? (
            <span className="ml-2 rounded-full bg-[color:var(--state-positive-soft)] px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.06em] text-state-positive">
              Cluster Buy Signal
            </span>
          ) : null}
        </div>
      </div>

      {hasTransactions ? (
        <>
          <InsiderTimelineChart transactions={data.transactions} />
          <InsiderTransactionList transactions={data.transactions} />
        </>
      ) : (
        <div className="text-[13px] text-text-tertiary">
          No purchases or sales in the last 90 days.
        </div>
      )}
    </div>
  );
}
