"use client";

import { useState } from "react";

import { useHoldingsStore } from "@/lib/holdings";

type Props = {
  ticker: string;
};

export function AddToPortfolioPill({ ticker }: Props) {
  const holdings = useHoldingsStore((s) => s.holdings);
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const add = useHoldingsStore((s) => s.add);
  const [editing, setEditing] = useState(false);
  const [shares, setShares] = useState("");

  if (!hasHydrated) return null;
  const alreadyHeld = holdings.some((h) => h.ticker === ticker);
  if (alreadyHeld) return null;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-bg-soft px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary"
      >
        <span aria-hidden>＋</span> Add to portfolio
      </button>
    );
  }

  const n = Number(shares);
  const valid = shares.trim() !== "" && Number.isFinite(n) && n > 0;
  const submit = () => {
    if (!valid) return;
    add(ticker, n);
    setEditing(false);
    setShares("");
  };

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-bg-soft px-2 py-1">
      <input
        autoFocus
        type="number"
        min="0"
        step="any"
        value={shares}
        onChange={(e) => setShares(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          else if (e.key === "Escape") {
            setEditing(false);
            setShares("");
          }
        }}
        placeholder="shares"
        className="w-20 bg-transparent text-[12px] tabular-nums text-text-primary outline-none placeholder:text-text-tertiary"
      />
      <button
        type="button"
        disabled={!valid}
        onClick={submit}
        className="rounded-full bg-text-primary px-2.5 py-0.5 text-[11px] font-medium text-[color:var(--bg-primary)] disabled:opacity-40"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setShares("");
        }}
        aria-label="Cancel"
        className="px-1 text-[14px] text-text-tertiary hover:text-text-primary"
      >
        ×
      </button>
    </div>
  );
}
