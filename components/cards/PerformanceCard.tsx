"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { motion } from "motion/react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { colors } from "@/lib/design-tokens";
import { formatLocalMoney, formatPct } from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";
import { EASE_OUT_STRONG } from "@/lib/motion";
import {
  computePerformance,
  type HistoryResponse,
  type PerformanceResult,
} from "@/lib/performance";

import { Watermark } from "../Watermark";

const RANGES = ["1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
type RangeKey = (typeof RANGES)[number];

type Props = {
  currencyByTicker: Record<string, string>;
  brandColorByTicker: Record<string, string>;
};

function eur(v: number | null | undefined, compact = false): string {
  return formatLocalMoney(v, "EUR", { compact });
}

function formatAxisDate(iso: string, span: "short" | "year"): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return span === "year"
    ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PerformanceCard({ currencyByTicker, brandColorByTicker }: Props) {
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const holdings = useHoldingsStore((s) => s.holdings);

  const [range, setRange] = useState<RangeKey>("1Y");
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  // Stable key for the *set* of tickers — refetch only when the basket
  // membership or the range changes, not when share counts are edited.
  const tickerKey = useMemo(
    () =>
      holdings
        .map((h) => h.ticker)
        .sort()
        .join(","),
    [holdings],
  );

  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!hasHydrated) return;
    // No holdings → the component renders its empty state without touching
    // `history`, so we just bail rather than clearing state in the effect.
    if (tickerKey === "") return;
    const key = `${range}|${tickerKey}`;
    if (key === lastKey.current && history) return;
    lastKey.current = key;

    const controller = new AbortController();
    setLoading(true);
    setErrored(false);
    fetch(`/api/history?tickers=${encodeURIComponent(tickerKey)}&range=${range}`, {
      signal: controller.signal,
    })
      .then((r) => r.json() as Promise<HistoryResponse>)
      .then((data) => {
        setHistory(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setErrored(true);
        setLoading(false);
      });
    return () => controller.abort();
    // history intentionally excluded — it's the thing we're setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey, range, hasHydrated]);

  const perf = useMemo<PerformanceResult | null>(() => {
    if (!history) return null;
    return computePerformance(holdings, history, currencyByTicker);
  }, [history, holdings, currencyByTicker]);

  if (!hasHydrated) {
    return <div className="h-[360px] animate-pulse rounded-2xl bg-[color:var(--bg-card-soft)]" />;
  }

  if (holdings.length === 0) {
    return (
      <EmptyState>
        Add holdings to trace the value of your basket over time — its growth,
        its drawdowns, and which positions drove the move.
      </EmptyState>
    );
  }

  const up = perf ? perf.totalReturn >= 0 : true;
  const lineColor = up ? colors.statePositive : colors.stateNegative;

  return (
    <div className="flex flex-col gap-10">
      {/* Header: headline return + range control */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.10em] text-text-tertiary">
            Total return · {range === "MAX" ? "max" : range}
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className="text-[44px] font-light leading-none tabular-nums tracking-tight md:text-[56px]"
              style={{ color: perf ? lineColor : "var(--text-tertiary)" }}
            >
              {perf ? formatPct(perf.totalReturn, { sign: true, digits: 1 }) : "—"}
            </span>
            {perf ? (
              <span className="text-[14px] tabular-nums text-text-tertiary">
                {eur(perf.startValue, true)} → {eur(perf.endValue, true)}
              </span>
            ) : null}
          </div>
          {perf ? (
            <div className="mt-1 text-[12px] tabular-nums text-text-tertiary">
              {formatAxisDate(perf.startDate, "year")} – {formatAxisDate(perf.endDate, "year")}
              {perf.limitedBy ? (
                <span>
                  {" "}· window starts with{" "}
                  <span className="text-text-secondary">{perf.limitedBy.ticker}</span> (
                  {formatAxisDate(perf.limitedBy.firstDate, "year")})
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <RangeToggle value={range} onChange={setRange} />
      </div>

      {/* Equity curve */}
      <div className={"transition-opacity duration-300 " + (loading ? "opacity-40" : "opacity-100")}>
        {errored ? (
          <ChartMessage>Couldn&apos;t load price history. Try another range.</ChartMessage>
        ) : perf ? (
          <EquityChart perf={perf} color={lineColor} />
        ) : loading ? (
          <div className="h-[300px] rounded-2xl bg-[color:var(--bg-card-soft)]/60" />
        ) : (
          <ChartMessage>
            No overlapping price history for these holdings in this range.
          </ChartMessage>
        )}
      </div>

      {perf ? (
        <>
          <StatStrip perf={perf} />
          <Contributions
            perf={perf}
            brandColorByTicker={brandColorByTicker}
          />
          {perf.missingTickers.length > 0 ? (
            <p className="text-[11px] text-text-tertiary">
              No price history for {perf.missingTickers.join(", ")} — excluded from the curve.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---------------- equity + underwater charts ----------------

function EquityChart({ perf, color }: { perf: PerformanceResult; color: string }) {
  const data = perf.points;
  const span: "short" | "year" = perf.years >= 0.75 ? "year" : "short";

  // A little vertical headroom so the line never kisses the frame.
  const lows = data.map((p) => p.indexed);
  const min = Math.min(...lows);
  const max = Math.max(...lows);
  const pad = Math.max((max - min) * 0.12, 1);

  const firstDate = data[0]?.date ?? "";
  const lastDate = data[data.length - 1]?.date ?? "";

  return (
    <div className="relative">
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis domain={[min - pad, max + pad]} hide />
            <ReferenceLine
              y={100}
              stroke="var(--divider)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <Tooltip
              cursor={{ stroke: "var(--divider)", strokeWidth: 1 }}
              wrapperStyle={{ outline: "none" }}
              content={<CurveTooltip startValue={perf.startValue} span={span} />}
            />
            <Area
              type="monotone"
              dataKey="indexed"
              stroke={color}
              strokeWidth={2}
              fill="url(#perfFill)"
              isAnimationActive
              animationDuration={650}
              animationEasing="ease-out"
              dot={false}
              activeDot={{ r: 3, fill: color, stroke: "var(--bg-secondary)", strokeWidth: 1.5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Underwater / drawdown ribbon */}
      <div className="mt-1 h-[58px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={58}>
          <AreaChart data={data} margin={{ top: 2, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.stateNegative} stopOpacity={0.02} />
                <stop offset="100%" stopColor={colors.stateNegative} stopOpacity={0.18} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis domain={[Math.min(perf.maxDrawdown, -0.001), 0]} hide />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke={colors.stateNegative}
              strokeWidth={1}
              strokeOpacity={0.5}
              fill="url(#ddFill)"
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
        <span className="tabular-nums">{formatAxisDate(firstDate, span)}</span>
        <span>drawdown · peak-to-date</span>
        <span className="tabular-nums">{formatAxisDate(lastDate, span)}</span>
      </div>
      <Watermark className="absolute right-2 top-1" />
    </div>
  );
}

function CurveTooltip({
  active,
  payload,
  startValue,
  span,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { date: string; value: number; indexed: number; drawdown: number } }>;
  startValue: number;
  span: "short" | "year";
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  const ret = pt.value / startValue - 1;
  const tone = ret >= 0 ? colors.statePositive : colors.stateNegative;
  return (
    <div
      className="rounded-lg border border-[color:var(--hairline-soft)] px-3 py-2 text-[11px] backdrop-blur-md"
      style={{ background: "rgba(255,255,255,0.88)", boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}
    >
      <div className="font-semibold tabular-nums text-text-primary">
        {formatAxisDate(pt.date, span)}
      </div>
      <div className="mt-1 tabular-nums text-text-primary">{eur(pt.value)}</div>
      <div className="mt-0.5 tabular-nums" style={{ color: tone }}>
        {formatPct(ret, { sign: true, digits: 1 })} since start
      </div>
      {pt.drawdown < -0.0005 ? (
        <div className="mt-0.5 tabular-nums text-text-tertiary">
          {formatPct(pt.drawdown, { digits: 1 })} off peak
        </div>
      ) : null}
    </div>
  );
}

// ---------------- stat strip ----------------

function StatStrip({ perf }: { perf: PerformanceResult }) {
  const items: { label: string; value: string; tone?: string; hint?: string }[] = [
    {
      label: "CAGR",
      value: perf.cagr === null ? "—" : formatPct(perf.cagr, { sign: true, digits: 1 }),
      tone: perf.cagr === null ? undefined : perf.cagr >= 0 ? colors.statePositive : colors.stateNegative,
      hint: "annualised",
    },
    {
      label: "Max drawdown",
      value: formatPct(perf.maxDrawdown, { digits: 1 }),
      tone: colors.stateNegative,
      hint: perf.maxDrawdownDate ? formatAxisDate(perf.maxDrawdownDate, "year") : "peak-to-trough",
    },
    {
      label: "Volatility",
      value: perf.annualVol === null ? "—" : formatPct(perf.annualVol, { digits: 1 }),
      hint: "annualised",
    },
    {
      label: "Sharpe",
      value: perf.sharpe === null ? "—" : perf.sharpe.toFixed(2),
      hint: "rf = 0",
    },
    {
      label: "Best day",
      value: perf.bestDay ? formatPct(perf.bestDay.ret, { sign: true, digits: 1 }) : "—",
      tone: colors.statePositive,
      hint: perf.bestDay ? formatAxisDate(perf.bestDay.date, "short") : "",
    },
    {
      label: "Worst day",
      value: perf.worstDay ? formatPct(perf.worstDay.ret, { digits: 1 }) : "—",
      tone: colors.stateNegative,
      hint: perf.worstDay ? formatAxisDate(perf.worstDay.date, "short") : "",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-[color:var(--hairline-faint)] pt-6 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            {it.label}
          </span>
          <span
            className="mt-1.5 text-[22px] font-light leading-none tabular-nums md:text-[26px]"
            style={{ color: it.tone ?? "var(--text-primary)" }}
          >
            {it.value}
          </span>
          {it.hint ? (
            <span className="mt-1 text-[11px] tabular-nums text-text-tertiary">{it.hint}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------- contribution decomposition ----------------

function Contributions({
  perf,
  brandColorByTicker,
}: {
  perf: PerformanceResult;
  brandColorByTicker: Record<string, string>;
}) {
  const all = perf.contributions;
  if (all.length === 0) return null;

  // Show all when the basket is small; otherwise the biggest movers both ways.
  const rows =
    all.length <= 14
      ? all
      : [...all.slice(0, 7), ...all.slice(all.length - 7)];
  const maxAbs = Math.max(...all.map((c) => Math.abs(c.contribution)), 1e-6);

  return (
    <div className="border-t border-[color:var(--hairline-faint)] pt-6">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.10em] text-text-secondary">
          Contribution to return
        </h3>
        <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
          weight × move · sums to total
        </span>
      </div>
      <ul className="flex flex-col">
        {rows.map((c, idx) => {
          const positive = c.contribution >= 0;
          const tone = positive ? colors.statePositive : colors.stateNegative;
          const widthPct = (Math.abs(c.contribution) / maxAbs) * 50;
          const brand = brandColorByTicker[c.ticker];
          return (
            <motion.li
              key={c.ticker}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: idx * 0.025, ease: EASE_OUT_STRONG }}
              className="grid grid-cols-[88px_1fr_92px] items-center gap-3 py-1.5"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: brand ?? "var(--text-tertiary)" }}
                />
                <span className="truncate text-[13px] font-medium tabular-nums text-text-primary">
                  {c.ticker}
                </span>
              </div>

              {/* Diverging bar with a centre baseline. */}
              <div className="relative h-[18px]">
                <div className="absolute left-1/2 top-0 h-full w-px bg-[color:var(--hairline-soft)]" />
                <div
                  className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-[3px]"
                  style={{
                    background: tone,
                    width: `${widthPct}%`,
                    left: positive ? "50%" : undefined,
                    right: positive ? undefined : "50%",
                    opacity: 0.9,
                  }}
                />
              </div>

              <div className="flex flex-col items-end leading-tight">
                <span className="text-[13px] font-semibold tabular-nums" style={{ color: tone }}>
                  {formatPct(c.contribution, { sign: true, digits: 1 })}
                </span>
                <span className="text-[10px] tabular-nums text-text-tertiary">
                  {formatPct(c.weightStart, { digits: 0 })} · {formatPct(c.ret, { sign: true, digits: 0 })}
                </span>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------- range toggle ----------------

function RangeToggle({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return (
    <div className="inline-flex rounded-full bg-[color:var(--bg-card-soft)] p-0.5">
      {RANGES.map((r) => {
        const selected = r === value;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={
              "rounded-full px-3 py-1.5 text-[12px] font-medium tabular-nums transition-colors duration-150 " +
              (selected
                ? "bg-bg-secondary text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary")
            }
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

// ---------------- shared bits ----------------

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--hairline-soft)] px-8 py-12 text-center">
      <p className="max-w-sm text-[14px] leading-relaxed text-text-tertiary">{children}</p>
    </div>
  );
}

function ChartMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-2xl bg-[color:var(--bg-card-soft)]/40 px-8 text-center text-[13px] text-text-tertiary">
      {children}
    </div>
  );
}
