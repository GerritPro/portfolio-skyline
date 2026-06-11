"use client";

import { useEffect, useState } from "react";

import type { LastUpdateStamps } from "@/lib/stock-data-loader";

type Props = {
  stamps: LastUpdateStamps;
};

function timeAgo(iso: string | undefined, now: number): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = now - t;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins <= 1 ? "1m ago" : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1h ago" : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

export function UpdateStamps({ stamps }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    // Refresh the relative-time labels every minute.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const prices = timeAgo(stamps.prices, now);
  const fund = timeAgo(stamps.fundamentals, now);
  const jp = timeAgo(stamps.japan, now);

  const parts: { label: string; value: string }[] = [];
  if (prices) parts.push({ label: "Prices", value: prices });
  if (fund) parts.push({ label: "Fundamentals", value: fund });
  if (jp) parts.push({ label: "Japan", value: jp });
  if (parts.length === 0) return null;

  return (
    <span className="text-[12px] tabular-nums text-text-tertiary">
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 ? <span aria-hidden className="px-1.5 opacity-40">·</span> : null}
          <span>{p.label} </span>
          <span className="text-text-secondary">{p.value}</span>
        </span>
      ))}
    </span>
  );
}
