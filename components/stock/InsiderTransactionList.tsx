"use client";

import type { InsiderTransaction } from "@/lib/types";

type Props = {
  transactions: InsiderTransaction[];
};

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

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
}

export function InsiderTransactionList({ transactions }: Props) {
  const visible = transactions
    .filter((t) => t.type !== "A")
    .sort((a, b) => (a.filing_date < b.filing_date ? 1 : -1));

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 grid grid-cols-[88px_1fr_140px_44px_88px_72px_88px_36px] items-baseline gap-3 border-b border-[color:var(--hairline-soft)] pb-2 text-[12px] uppercase tracking-[0.06em] text-text-tertiary">
        <span>Date</span>
        <span>Insider</span>
        <span>Title</span>
        <span>Type</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Price</span>
        <span className="text-right">Value</span>
        <span />
      </div>
      <ul className="flex flex-col divide-y divide-[color:var(--hairline-faint)]">
        {visible.map((t, i) => {
          const isBuy = t.type === "P";
          const isSell = t.type === "S";
          const isPlan = isSell && t.is_10b51;
          const rowTint = isBuy
            ? "bg-[color:var(--state-positive-soft)]/30"
            : isSell
              ? isPlan
                ? ""
                : "bg-[color:var(--state-negative-soft)]/30"
              : "";
          const rowOpacity = isPlan ? "opacity-60" : "";
          return (
            <li
              key={`${t.filing_date}-${t.insider_name}-${i}`}
              className={
                "grid grid-cols-[88px_1fr_140px_44px_88px_72px_88px_36px] items-baseline gap-3 py-2 transition-colors hover:bg-bg-soft " +
                rowTint +
                " " +
                rowOpacity
              }
            >
              <span className="text-[13px] tabular-nums text-text-tertiary">
                {formatDate(t.trade_date)}
              </span>
              <span className="text-[14px] font-medium text-text-primary">
                {t.insider_name}
              </span>
              <span className="truncate text-[13px] text-text-tertiary">
                {t.title}
              </span>
              <span
                className={
                  "text-[13px] font-semibold tabular-nums " +
                  (isBuy
                    ? "text-state-positive"
                    : isSell
                      ? "text-state-negative"
                      : "text-text-tertiary")
                }
              >
                {t.type}
              </span>
              <span className="text-right text-[13px] tabular-nums text-text-primary">
                {formatNumber(t.shares)}
              </span>
              <span className="text-right text-[13px] tabular-nums text-text-secondary">
                {t.price !== null ? `$${t.price.toFixed(2)}` : "—"}
              </span>
              <span className="text-right text-[13px] tabular-nums text-text-primary">
                {formatMoney(t.value)}
              </span>
              <span className="text-right text-[9px] uppercase tracking-[0.06em] text-text-tertiary">
                {isPlan ? "Plan" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
