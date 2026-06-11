/**
 * Data-freshness assessment. The dashboard renders prices and metrics as
 * of a fixed pull date; without a clear signal a three-week-old close
 * reads as if it were live. This turns the pull date into an honest,
 * market-aware staleness verdict.
 *
 * Pure and side-effect free — `now` is always injected so it stays
 * deterministic and testable. Staleness is graded in *trading days*
 * (weekday sessions) so a Friday close viewed on Monday is "fresh", not
 * "3 days old"; the human label uses calendar time, which is how people
 * actually read recency.
 */

export type FreshnessTier = "current" | "fresh" | "recent" | "aging" | "stale";

/** Maps to colours in the badge; finance-positive = recent. */
export type FreshnessTone = "positive" | "neutral" | "warning" | "negative";

export type Freshness = {
  tier: FreshnessTier;
  tone: FreshnessTone;
  /** Calendar-relative label: "today", "yesterday", "3 days ago", "3 weeks ago". */
  label: string;
  /** Compact form for tight chips: "today", "1d", "3w", "2mo". */
  short: string;
  /** Trading sessions elapsed since the as-of date. */
  tradingDaysBehind: number;
  /** Plain calendar days since the as-of date. */
  calendarDays: number;
  /** Pretty, absolute date — "May 19, 2026". */
  exactDate: string;
};

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Parse a yyyy-mm-dd (or ISO timestamp) to a UTC-midnight epoch. */
function parseDayUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Weekday sessions strictly after `from` up to and including `to`. */
export function tradingDaysBetween(fromUtc: number, toUtc: number): number {
  if (toUtc <= fromUtc) return 0;
  const DAY = 86_400_000;
  const spanDays = Math.round((toUtc - fromUtc) / DAY);
  // Cheap exact count for normal spans; approximate well beyond a year.
  if (spanDays > 1500) return Math.round((spanDays * 5) / 7);
  let count = 0;
  for (let d = fromUtc + DAY; d <= toUtc; d += DAY) {
    const dow = new Date(d).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

function relativeLabel(days: number): { label: string; short: string } {
  if (days <= 0) return { label: "today", short: "today" };
  if (days === 1) return { label: "yesterday", short: "1d" };
  if (days < 7) return { label: `${days} days ago`, short: `${days}d` };
  if (days < 14) return { label: "1 week ago", short: "1w" };
  if (days < 56) {
    const w = Math.round(days / 7);
    return { label: `${w} weeks ago`, short: `${w}w` };
  }
  if (days < 365) {
    const mo = Math.round(days / 30);
    return { label: mo === 1 ? "1 month ago" : `${mo} months ago`, short: `${mo}mo` };
  }
  const y = Math.round((days / 365) * 10) / 10;
  return { label: y === 1 ? "1 year ago" : `${y} years ago`, short: `${y}y` };
}

function tierFor(tradingDaysBehind: number): { tier: FreshnessTier; tone: FreshnessTone } {
  if (tradingDaysBehind <= 0) return { tier: "current", tone: "positive" };
  if (tradingDaysBehind <= 1) return { tier: "fresh", tone: "positive" };
  if (tradingDaysBehind <= 3) return { tier: "recent", tone: "neutral" };
  if (tradingDaysBehind <= 9) return { tier: "aging", tone: "warning" };
  return { tier: "stale", tone: "negative" };
}

function prettyDate(utc: number): string {
  return new Date(utc).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Grade the freshness of data pulled as of `asOf` (a yyyy-mm-dd trading
 * date — typically metadata.data_version), evaluated at `now`.
 */
export function assessFreshness(asOf: string, now: number): Freshness | null {
  const asOfUtc = parseDayUtc(asOf);
  if (asOfUtc === null) return null;
  const todayUtc = startOfUtcDay(now);

  const DAY = 86_400_000;
  const calendarDays = Math.max(0, Math.round((todayUtc - asOfUtc) / DAY));
  const tradingDaysBehind = tradingDaysBetween(asOfUtc, todayUtc);

  const { tier, tone } = tierFor(tradingDaysBehind);
  const { label, short } = relativeLabel(calendarDays);

  return {
    tier,
    tone,
    label,
    short,
    tradingDaysBehind,
    calendarDays,
    exactDate: prettyDate(asOfUtc),
  };
}

/** Pretty absolute date from a yyyy-mm-dd, independent of `now`. */
export function formatTradingDate(asOf: string): string {
  const utc = parseDayUtc(asOf);
  return utc === null ? asOf : prettyDate(utc);
}

/** Resolved colours per tone — kept here so badge + hero stay consistent. */
export const FRESHNESS_COLORS: Record<FreshnessTone, string> = {
  positive: "#30A46C",
  neutral: "#86868B",
  warning: "#BE7A1B",
  negative: "#E5484D",
};
