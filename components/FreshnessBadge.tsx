"use client";

import { useEffect, useState } from "react";

import {
  assessFreshness,
  formatTradingDate,
  FRESHNESS_COLORS,
  type Freshness,
} from "@/lib/freshness";

type Props = {
  /** yyyy-mm-dd trading date the data represents (metadata.data_version). */
  asOf: string;
  /** ISO timestamp of when the pull actually ran (metadata.generated_at). */
  generatedAt?: string;
  /** "badge" → header pill; "inline" → bare dot + text for the hero strip. */
  variant?: "badge" | "inline";
};

const TIER_WORD: Record<Freshness["tier"], string> = {
  current: "Live",
  fresh: "Fresh",
  recent: "Recent",
  aging: "Aging",
  stale: "Stale",
};

/**
 * Honest data-recency indicator. Server render (and first client paint)
 * shows only the absolute date with a neutral dot; once mounted we
 * enhance to the live relative label + tone. Splitting it this way keeps
 * the time-dependent text out of hydration so there's no mismatch.
 */
export function FreshnessBadge({ asOf, generatedAt, variant = "badge" }: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Defer the first tick into a rAF callback (not the effect body) so we
    // never setState synchronously, and so `now` stays null through SSR +
    // first paint — that keeps the relative label out of hydration.
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, 60_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  const fresh = now === null ? null : assessFreshness(asOf, now);
  const color = fresh ? FRESHNESS_COLORS[fresh.tone] : FRESHNESS_COLORS.neutral;
  const staticDate = fresh?.exactDate ?? formatTradingDate(asOf);

  const title = fresh
    ? `Data as of ${fresh.exactDate} · ${fresh.tradingDaysBehind} trading ${
        fresh.tradingDaysBehind === 1 ? "session" : "sessions"
      } behind` + (generatedAt ? `\nPulled ${new Date(generatedAt).toLocaleString()}` : "")
    : `Data as of ${staticDate}`;

  if (variant === "inline") {
    return (
      <span className="inline-flex items-center gap-1.5 align-baseline" title={title}>
        <Dot color={color} pulse={fresh?.tier === "current"} />
        {/* Text only appears post-mount — keeps the relative label out of
            hydration so there's never a server/client mismatch. */}
        {fresh ? (
          <span style={fresh.tone !== "neutral" ? { color } : undefined}>{fresh.label}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      title={title}
      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--hairline-soft)] bg-bg-secondary px-2.5 py-1 text-[12px] tabular-nums shadow-[var(--shadow-card)]"
    >
      <Dot color={color} pulse={fresh?.tier === "current"} />
      <span className="font-medium" style={{ color: fresh ? color : "var(--text-secondary)" }}>
        {fresh ? TIER_WORD[fresh.tier] : "Data"}
      </span>
      <span className="text-text-tertiary">{fresh ? fresh.label : staticDate}</span>
    </span>
  );
}

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span aria-hidden className="relative inline-flex h-2 w-2 items-center justify-center">
      {pulse ? (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ background: color }}
        />
      ) : null}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
