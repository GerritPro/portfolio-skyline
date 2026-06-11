"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { InsiderTransaction } from "@/lib/types";

type Props = {
  transactions: InsiderTransaction[];
};

type Point = {
  trade_date_epoch: number;
  signed_value: number;
  size: number;
  tx: InsiderTransaction;
  kind: "buy" | "sell" | "plan_sell";
};

function dateEpoch(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  return d.getTime();
}

function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatTickDate(epoch: number): string {
  const d = new Date(epoch);
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function InsiderTimelineChart({ transactions }: Props) {
  // Stable "now" for the 90d X-axis domain via lazy useState — runs once at
  // mount, never re-evaluates.
  const [todayMs] = useState<number>(() => Date.now());

  const { points, maxAbs, today, ninety } = useMemo(() => {
    const t = todayMs;
    const ninetyMs = t - 90 * 24 * 60 * 60 * 1000;
    let mx = 0;
    const pts: Point[] = [];
    for (const tx of transactions) {
      if (tx.type === "A") continue;
      if (tx.type !== "P" && tx.type !== "S") continue;
      const epoch = dateEpoch(tx.trade_date);
      if (!Number.isFinite(epoch)) continue;
      const abs = Math.abs(tx.value ?? 0);
      const signed = tx.type === "P" ? abs : -abs;
      const kind: Point["kind"] =
        tx.type === "P" ? "buy" : tx.is_10b51 ? "plan_sell" : "sell";
      pts.push({ trade_date_epoch: epoch, signed_value: signed, size: abs, tx, kind });
      if (abs > mx) mx = abs;
    }
    return { points: pts, maxAbs: mx, today: t, ninety: ninetyMs };
  }, [transactions, todayMs]);

  if (points.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-[13px] text-text-tertiary">
        No purchases or sales in the last 90 days.
      </div>
    );
  }

  const buys = points.filter((p) => p.kind === "buy");
  const sells = points.filter((p) => p.kind === "sell");
  const planSells = points.filter((p) => p.kind === "plan_sell");

  // Marker size scaled by sqrt of value; range 4-16 px.
  const sizeFor = (v: number): number => {
    if (maxAbs <= 0) return 6;
    const t = Math.sqrt(v / maxAbs);
    return 4 + t * 12;
  };

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 16 }}>
          <CartesianGrid stroke="var(--hairline-faint)" vertical={false} />
          <XAxis
            type="number"
            dataKey="trade_date_epoch"
            domain={[ninety, today]}
            tickFormatter={formatTickDate}
            tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--hairline-soft)" }}
            scale="time"
          />
          <YAxis
            type="number"
            dataKey="signed_value"
            tickFormatter={formatMoney}
            tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ZAxis type="number" dataKey="size" range={[40, 400]} />
          <ReferenceLine y={0} stroke="var(--hairline-soft)" />
          <Tooltip
            cursor={{ stroke: "var(--divider)", strokeWidth: 1 }}
            content={<InsiderTooltip />}
            wrapperStyle={{ outline: "none" }}
          />
          <Scatter
            name="Buy"
            data={buys}
            fill="var(--state-positive)"
            shape={(props: { cx?: number; cy?: number; payload?: Point }) => {
              const { cx = 0, cy = 0, payload } = props;
              const r = sizeFor(payload?.size ?? 0);
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="var(--state-positive)"
                  fillOpacity={0.7}
                  stroke="var(--bg-primary)"
                  strokeWidth={1.5}
                />
              );
            }}
            isAnimationActive={false}
          />
          <Scatter
            name="Sell"
            data={sells}
            fill="var(--state-negative)"
            shape={(props: { cx?: number; cy?: number; payload?: Point }) => {
              const { cx = 0, cy = 0, payload } = props;
              const r = sizeFor(payload?.size ?? 0);
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="var(--state-negative)"
                  fillOpacity={0.7}
                  stroke="var(--bg-primary)"
                  strokeWidth={1.5}
                />
              );
            }}
            isAnimationActive={false}
          />
          <Scatter
            name="10b5-1 Sell"
            data={planSells}
            fill="var(--text-tertiary)"
            shape={(props: { cx?: number; cy?: number; payload?: Point }) => {
              const { cx = 0, cy = 0, payload } = props;
              const r = sizeFor(payload?.size ?? 0);
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="var(--text-tertiary)"
                  fillOpacity={0.5}
                  stroke="var(--bg-primary)"
                  strokeWidth={1}
                />
              );
            }}
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function InsiderTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Point }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  const t = pt.tx;
  const dateLabel = new Date(t.trade_date + "T00:00:00Z").toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
  return (
    <div
      className="rounded-lg border border-[color:var(--hairline-soft)] px-3 py-2 text-[11px] backdrop-blur-md"
      style={{
        background: "rgba(255, 255, 255, 0.85)",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.06)",
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-text-primary">{t.insider_name}</span>
        <span className="text-text-tertiary">{t.title}</span>
      </div>
      <div className="mt-1 tabular-nums text-text-tertiary">
        {dateLabel} · {t.type === "P" ? "Purchase" : "Sale"}
        {t.is_10b51 ? " (10b5-1)" : ""}
      </div>
      <div className="mt-1 tabular-nums">
        <span className="text-text-tertiary">Shares </span>
        <span className="text-text-primary">{formatNumber(t.shares)}</span>
        <span className="px-1.5 text-text-tertiary">·</span>
        <span className="text-text-tertiary">Price </span>
        <span className="text-text-primary">
          {t.price !== null ? `$${t.price.toFixed(2)}` : "—"}
        </span>
      </div>
      <div className="mt-1 tabular-nums">
        <span className="text-text-tertiary">Total </span>
        <span className="text-text-primary">{formatMoney(t.value)}</span>
      </div>
    </div>
  );
}
