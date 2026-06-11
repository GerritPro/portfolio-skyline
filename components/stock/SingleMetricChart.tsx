"use client";

import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatLocalMoney,
  formatPct,
  formatRatio,
  toneFor,
} from "@/lib/format";
import { METRICS, type MetricKey } from "@/lib/metric-catalog";
import {
  fetchMetric,
  getCachedMetric,
  subscribeMetricCache,
  type MetricData,
  type MetricQuarterPoint,
  type MetricViewKey,
} from "@/lib/metric-fetch";
import {
  fetchStockPrices,
  getCachedStockPrices,
  subscribeStockPricesCache,
  type StockPriceSeries,
} from "@/lib/stock-prices-fetch";
import type { StockMetadata } from "@/lib/stock-data-loader";

import { EASE } from "../AnimateStack";
import { TimeRangeToggle, type RangeKey } from "../TimeRangeToggle";
import { ViewToggle } from "../ViewToggle";
import { Watermark } from "../Watermark";

type Props = {
  ticker: string;
  metricKey: MetricKey;
  metadata?: Pick<StockMetadata, "brand_color" | "logo_path" | "name" | "ticker" | "currency">;
};

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-state-positive",
  negative: "text-state-negative",
  neutral: "text-text-tertiary",
};

const NEUTRAL_BRAND = "var(--text-primary)";

const RANGE_START_DAYS: Record<RangeKey, number | null> = {
  "1Y": 365,
  "3Y": 365 * 3,
  "5Y": 365 * 5,
  "10Y": 365 * 10,
  ALL: null,
};

const RANGE_PRICE_STRIDE: Record<RangeKey, number> = {
  "1Y": 1,
  "3Y": 1,
  "5Y": 5,
  "10Y": 10,
  ALL: 20,
};

function formatValue(
  v: number | null | undefined,
  format: MetricData["format"],
  currency?: string | null,
): string {
  if (format === "currency") return formatLocalMoney(v, currency ?? "USD", { compact: true });
  if (format === "percent") return formatRatio(v);
  if (format === "perShare") return formatLocalMoney(v, currency ?? "USD");
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(1);
}

function formatTooltipPeriod(period: string): string {
  const [year, q] = period.split("-Q");
  if (!year || !q) return period;
  return `Q${q} ${year}`;
}

function formatReportDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function dateLabelForAxis(iso: string, range: RangeKey): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const year = m[1];
  const month = parseInt(m[2], 10);
  if (range === "1Y") {
    // Quarter labels: Mar=Q1, Jun=Q2, Sep=Q3, Dec=Q4 — show at first month of each quarter.
    if (month === 1 || month === 4 || month === 7 || month === 10) return new Date(iso + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return "";
  }
  if (range === "3Y") {
    return month === 1 ? year : "";
  }
  if (range === "5Y") {
    return month === 1 && parseInt(year, 10) % 2 === 1 ? year : "";
  }
  return month === 1 ? year : "";
}

type YDomain = { domain: [number, number]; showZero: boolean };

function computeYDomain(values: (number | null)[]): YDomain {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return { domain: [0, 1], showZero: false };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const crossesZero = min < 0 && max > 0;
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.05, 0.5);
    return { domain: [min - pad, max + pad], showZero: crossesZero };
  }
  const padding = (max - min) * 0.05;
  let yMin = min - padding;
  let yMax = max + padding;
  if (crossesZero) {
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
  }
  return { domain: [yMin, yMax], showZero: crossesZero };
}

function ratio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return a / b - 1;
}

type ChartRow = {
  date: string;
  value: number | null;
  price: number | null;
  period: string | null;
};

function buildChartData(
  quarters: MetricQuarterPoint[],
  priceSeries: StockPriceSeries | null,
  range: RangeKey,
  priceVisible: boolean,
): { rows: ChartRow[]; quarterRows: ChartRow[]; rangeStart: string | null; matchedRange: boolean } {
  // Filter quarters by fiscalDate within the range window.
  const rangeDays = RANGE_START_DAYS[range];
  const rangeStartIso: string | null = rangeDays === null
    ? null
    : new Date(Date.now() - rangeDays * 86400 * 1000).toISOString().slice(0, 10);

  const filteredQuarters = quarters.filter((q) => {
    if (!q.fiscalDate) return false;
    if (rangeStartIso && q.fiscalDate < rangeStartIso) return false;
    return true;
  });

  // Clip both lines to the fundamental's effective x-range: from the first
  // non-null quarter to the last quarter. Price extending earlier than the
  // fundamental looks like a bug because the metric line starts mid-chart.
  const nonNullQuarters = filteredQuarters.filter(
    (q) => q.value !== null && Number.isFinite(q.value),
  );
  const firstValidDate = nonNullQuarters.length > 0 ? (nonNullQuarters[0].fiscalDate as string) : null;
  // matchedRange tells the disclaimer whether we trimmed away requested
  // history (i.e. the metric had less depth than the toggle asked for).
  const matchedRange = firstValidDate !== null && rangeStartIso !== null && firstValidDate > rangeStartIso;

  const valueByDate = new Map<string, { value: number | null; period: string }>();
  for (const q of filteredQuarters) {
    if (q.fiscalDate) valueByDate.set(q.fiscalDate, { value: q.value, period: q.period });
  }

  if (!priceVisible || !priceSeries) {
    // Quarters only — date-x-axis with one row per quarter.
    const rows: ChartRow[] = filteredQuarters.map((q) => ({
      date: q.fiscalDate as string,
      value: q.value,
      price: null,
      period: q.period,
    }));
    return { rows, quarterRows: rows, rangeStart: rangeStartIso, matchedRange };
  }

  // Merge: walk priceSeries within the range, downsample by stride, and
  // insert quarter rows at their fiscal date. The Price line is clipped on
  // the LEFT to firstValidDate (so both lines start at the same x), but
  // extends fully on the RIGHT to today — fundamentals lag by ~45 days
  // after quarter-end so Price naturally runs past the last quarterly dot.
  const stride = RANGE_PRICE_STRIDE[range];
  const effectiveStart = firstValidDate ?? rangeStartIso;
  const priceByDate = new Map<string, number>();
  for (let i = 0; i < priceSeries.dates.length; i++) {
    const c = priceSeries.close[i];
    if (typeof c === "number" && Number.isFinite(c)) {
      priceByDate.set(priceSeries.dates[i], c);
    }
  }

  const orderedDates: string[] = [];
  for (let i = 0; i < priceSeries.dates.length; i++) {
    const d = priceSeries.dates[i];
    if (effectiveStart && d < effectiveStart) continue;
    if (i % stride === 0 || i === priceSeries.dates.length - 1 || valueByDate.has(d)) {
      orderedDates.push(d);
    }
  }

  // Ensure quarter anchors are present even if they fell outside the stride.
  for (const q of filteredQuarters) {
    if (q.fiscalDate && !orderedDates.includes(q.fiscalDate)) {
      orderedDates.push(q.fiscalDate);
    }
  }
  orderedDates.sort();
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const d of orderedDates) {
    if (seen.has(d)) continue;
    seen.add(d);
    dedup.push(d);
  }

  const rows: ChartRow[] = dedup.map((d) => {
    const qv = valueByDate.get(d);
    return {
      date: d,
      value: qv ? qv.value : null,
      price: priceByDate.get(d) ?? null,
      period: qv?.period ?? null,
    };
  });
  const quarterRows = rows.filter((r) => r.period !== null);
  return { rows, quarterRows, rangeStart: rangeStartIso, matchedRange };
}

export function SingleMetricChart({ ticker, metricKey, metadata }: Props) {
  const meta = METRICS[metricKey];
  const router = useRouter();
  const searchParams = useSearchParams();
  const brand = metadata?.brand_color ?? null;
  const logoPath = metadata?.logo_path ?? null;
  const brandColor = brand ?? NEUTRAL_BRAND;
  // Price line uses a fixed neutral gray that adapts to theme via CSS var.
  // Brand-derived variants were per-stock unpredictable (too pale on light
  // brands, too dark on dark ones); a single token keeps the secondary
  // line visually subordinate to the brand-coloured main metric line.
  const secondaryColor = "var(--price-line)";

  const priceParam = searchParams.get("price");
  const priceVisible = priceParam === "1";

  const viewParam = searchParams.get("view");
  const view: MetricViewKey = viewParam === "quarterly" ? "quarterly" : "ttm";

  const togglePrice = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (priceVisible) next.delete("price");
    else next.set("price", "1");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }, [router, searchParams, priceVisible]);

  const setView = useCallback(
    (v: MetricViewKey) => {
      const next = new URLSearchParams(searchParams.toString());
      if (v === "ttm") next.delete("view");
      else next.set("view", v);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const getMetricSnapshot = useCallback(
    () => getCachedMetric(ticker, metricKey) ?? null,
    [ticker, metricKey],
  );
  const data = useSyncExternalStore(subscribeMetricCache, getMetricSnapshot, () => null);

  const getPriceSnapshot = useCallback(
    () => getCachedStockPrices(ticker) ?? null,
    [ticker],
  );
  const priceData = useSyncExternalStore(subscribeStockPricesCache, getPriceSnapshot, () => null);

  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("5Y");
  const [growthMode, setGrowthMode] = useState<"yoy" | "qoq">("yoy");

  useEffect(() => {
    if (getCachedMetric(ticker, metricKey)) return;
    let cancelled = false;
    fetchMetric(ticker, metricKey).catch((e: Error) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker, metricKey]);

  useEffect(() => {
    if (!priceVisible) return;
    if (getCachedStockPrices(ticker)) return;
    fetchStockPrices(ticker).catch(() => {
      // Non-fatal — price line stays empty; metric chart still renders.
    });
  }, [ticker, priceVisible]);

  const activeView = data?.views[view] ?? null;

  const { rows, quarterRows, matchedRange } = useMemo(() => {
    const activeSeries: MetricQuarterPoint[] = activeView?.series ?? [];
    return buildChartData(activeSeries, priceData, range, priceVisible);
  }, [activeView, priceData, range, priceVisible]);

  const yDomainMetric = useMemo(
    () => computeYDomain(quarterRows.map((d) => d.value)),
    [quarterRows],
  );

  const yDomainPrice = useMemo(
    () => computeYDomain(rows.map((d) => d.price)),
    [rows],
  );

  const { start, last, peak, low, nonNullCount } = useMemo(() => {
    const nonNull = quarterRows.filter(
      (d): d is ChartRow & { value: number; period: string } =>
        d.value !== null && Number.isFinite(d.value) && d.period !== null,
    );
    if (nonNull.length === 0) {
      return { start: null, last: null, peak: null, low: null, nonNullCount: 0 };
    }
    let peakPt = nonNull[0];
    let lowPt = nonNull[0];
    for (const p of nonNull) {
      if (p.value > peakPt.value) peakPt = p;
      if (p.value < lowPt.value) lowPt = p;
    }
    return {
      start: nonNull[0],
      last: nonNull[nonNull.length - 1],
      peak: peakPt,
      low: lowPt,
      nonNullCount: nonNull.length,
    };
  }, [quarterRows]);

  const hasData = last !== null;
  const peakDistinct = peak !== null && last !== null && peak.date !== last.date;
  const lowDistinct =
    low !== null &&
    last !== null &&
    low.date !== last.date &&
    (peak === null || low.date !== peak.date);
  const referenceY = yDomainMetric.showZero ? 0 : start?.value ?? null;
  const gradientId = `metric-area-${metricKey}-${ticker}`;

  const growthValue = growthMode === "yoy" ? activeView?.yoy : activeView?.qoq;

  return (
    <div className="relative flex flex-col gap-6">
      <ChartHeader
        category={meta.category}
        label={meta.label}
        description={meta.description}
        logoPath={logoPath}
        brand={brandColor}
        ticker={metadata?.ticker ?? ticker}
        name={metadata?.name ?? ticker}
        controls={
          <>
            <TimeRangeToggle value={range} onChange={setRange} />
            <ViewToggle value={view} onChange={setView} />
            <button
              type="button"
              onClick={togglePrice}
              aria-pressed={priceVisible}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 ease-out " +
                (priceVisible
                  ? "bg-bg-secondary text-text-primary shadow-sm"
                  : "bg-bg-soft text-text-secondary hover:text-text-primary")
              }
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: priceVisible ? secondaryColor : "var(--text-tertiary)" }}
              />
              Show price
            </button>
          </>
        }
      />

      {/* Big-number block — the SINGLE source of the latest value display.
          Sits between header and chart, prominent and screenshot-friendly. */}
      {data && hasData && last ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-4">
            <span
              className="text-[48px] font-light leading-none tabular-nums md:text-[60px]"
              style={{ color: brandColor }}
            >
              {formatValue(last.value, data.format, data.currency)}
            </span>
            {(() => {
              const gv = growthValue ?? null;
              if (gv === null) return null;
              const arrow = gv >= 0 ? "↑" : "↓";
              return (
                <button
                  type="button"
                  onClick={() => setGrowthMode((m) => (m === "yoy" ? "qoq" : "yoy"))}
                  className={
                    "inline-flex items-baseline gap-1.5 text-[16px] font-semibold tabular-nums transition-colors md:text-[18px] " +
                    (gv >= 0 ? "text-state-positive" : "text-state-negative")
                  }
                >
                  {arrow} {formatPct(gv, { sign: true })}
                  <span className="text-[12px] uppercase tracking-[0.08em] text-text-tertiary md:text-[13px]">
                    {growthMode.toUpperCase()}
                  </span>
                </button>
              );
            })()}
          </div>
          <span className="text-[12px] uppercase tracking-[0.08em] text-text-tertiary md:text-[13px]">
            {view === "ttm" ? "TTM" : "Quarterly"}
            {last.period ? ` · as of ${formatTooltipPeriod(last.period)}` : ""}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="text-[13px] text-state-negative">Failed to load: {error}</div>
      ) : data && hasData ? (
        <motion.div
          key={`${ticker}/${metricKey}/${range}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="relative h-[min(70vh,620px)] min-h-[360px] w-full rounded-lg bg-[color:var(--bg-soft)]/30 md:min-h-[480px]"
        >
          {/* Minimal chart-internal legend — color indicator + metric name
              + view tag only. Identifies the line in screenshots. The
              actual value lives in the BigNumberBlock above the chart so
              there is exactly ONE place rendering the latest value. */}
          <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-2 text-[14px] font-medium uppercase tracking-[0.08em] text-text-secondary">
            <span
              aria-hidden
              className="inline-block h-[10px] w-[10px] rounded-full"
              style={{ background: brandColor }}
            />
            <span>{meta.label}</span>
            <span className="text-text-tertiary">· {view === "ttm" ? "TTM" : "Quarterly"}</span>
          </div>
          {priceVisible ? (
            <motion.div
              key="price-legend"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-2 text-[14px] font-medium uppercase tracking-[0.08em] text-text-secondary"
            >
              <span
                aria-hidden
                className="inline-block h-[4px] w-[14px]"
                style={{ background: "var(--price-line)" }}
              />
              <span>Price</span>
            </motion.div>
          ) : null}
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 40, right: 160, bottom: 32, left: 100 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={brandColor} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={brandColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => dateLabelForAxis(d, range)}
                tick={{ fill: "var(--text-secondary)", fontSize: 14 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis yAxisId="metric" hide domain={yDomainMetric.domain} />
              {priceVisible ? (
                <YAxis yAxisId="price" orientation="right" hide domain={yDomainPrice.domain} />
              ) : null}
              {referenceY !== null ? (
                <ReferenceLine
                  yAxisId="metric"
                  y={referenceY}
                  stroke={"var(--divider)"}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
              ) : null}
              <Tooltip
                cursor={{ stroke: "var(--divider)", strokeWidth: 1 }}
                content={
                  <ChartTooltip
                    rows={rows}
                    format={data.format}
                    currency={data.currency ?? null}
                    metricLabel={meta.label}
                    brandColor={brandColor}
                    secondaryColor={secondaryColor}
                    priceVisible={priceVisible}
                  />
                }
                animationDuration={100}
                animationEasing="ease-out"
                wrapperStyle={{ outline: "none" }}
                offset={12}
              />

              {/* Price line (when toggle on) — rendered before the metric so
                  the metric area sits on top in the SVG stacking order. */}
              {priceVisible ? (
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="price"
                  stroke={secondaryColor}
                  strokeWidth={2}
                  strokeOpacity={0.7}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={true}
                  animationDuration={200}
                  animationEasing="ease-out"
                  connectNulls={true}
                />
              ) : null}

              {/* Fundamental — main area + line with dots at every quarter. */}
              <Area
                yAxisId="metric"
                type="monotone"
                dataKey="value"
                stroke={brandColor}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${gradientId})`}
                dot={{ r: 6, fill: brandColor, stroke: "var(--bg-primary)", strokeWidth: 2 }}
                activeDot={{ r: 9, fill: "var(--accent-blue)", stroke: "var(--bg-primary)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={true}
              />

              {/* Current marker — halo + dot + inline latest-value annotation
                  + growth-badge anchored at the right edge of the line. */}
              {last !== null ? (
                <ReferenceDot
                  yAxisId="metric"
                  x={last.date}
                  y={last.value}
                  r={14}
                  fill={brandColor}
                  fillOpacity={0.22}
                  stroke="none"
                />
              ) : null}
              {last !== null ? (
                <ReferenceDot
                  yAxisId="metric"
                  x={last.date}
                  y={last.value}
                  r={8}
                  fill={brandColor}
                  stroke={"var(--bg-primary)"}
                  strokeWidth={2}
                />
              ) : null}

              {/* Start marker removed — kept overlapping the top-left
                  legend at edge cases and the InsightStrip below already
                  spells out the date range ("Q2 2021 to Q1 2026"). */}

              {/* Peak + Low markers — dots only, no $-value text. Values
                  belong exclusively to the BigNumberBlock above the chart
                  and to the Stats footer below. Plot stays clean and the
                  PEAK/LOW labels can no longer drift into the top-left
                  legend zone. */}
              {peakDistinct && peak !== null ? (
                <ReferenceDot
                  yAxisId="metric"
                  x={peak.date}
                  y={peak.value}
                  r={8}
                  fill={brandColor}
                  stroke={"var(--bg-primary)"}
                  strokeWidth={2}
                />
              ) : null}
              {lowDistinct && low !== null ? (
                <ReferenceDot
                  yAxisId="metric"
                  x={low.date}
                  y={low.value}
                  r={8}
                  fill={brandColor}
                  stroke={"var(--bg-primary)"}
                  strokeWidth={2}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </motion.div>
      ) : data ? (
        <div className="flex h-[440px] items-center justify-center text-[13px] text-text-tertiary">
          No data for this range.
        </div>
      ) : (
        <div className="h-[440px] w-full animate-pulse rounded bg-bg-soft" />
      )}

      {data ? (
        <InsightStrip
          data={data}
          activeView={activeView}
          nonNullCount={nonNullCount}
          view={view}
          metricKey={metricKey}
          firstPeriod={start?.period ?? null}
          lastPeriod={last?.period ?? null}
          matchedRange={matchedRange}
        />
      ) : null}

      <Watermark className="absolute right-6 bottom-4" />
    </div>
  );
}

function InsightStrip({
  data,
  activeView,
  nonNullCount,
  view,
  metricKey,
  firstPeriod,
  lastPeriod,
  matchedRange,
}: {
  data: MetricData;
  activeView: { cagr5y: number | null; series: MetricQuarterPoint[] } | null;
  nonNullCount: number;
  view: MetricViewKey;
  metricKey: MetricKey;
  firstPeriod: string | null;
  lastPeriod: string | null;
  matchedRange: boolean;
}) {
  const cagr = activeView?.cagr5y;
  const total = activeView?.series.length ?? 0;
  const missing = total - nonNullCount;
  const warmupReasons: string[] = [];
  if (view === "ttm" && missing > 0) warmupReasons.push("TTM rolling warmup");
  if (metricKey === "pe" && missing > 0) warmupReasons.push("TTM-EPS warmup");

  const rangeStr =
    firstPeriod && lastPeriod && firstPeriod !== lastPeriod
      ? `${formatTooltipPeriod(firstPeriod)} to ${formatTooltipPeriod(lastPeriod)}`
      : lastPeriod
        ? formatTooltipPeriod(lastPeriod)
        : "";
  const suffixParts: string[] = [];
  if (matchedRange) suffixParts.push("matched range");
  if (warmupReasons.length > 0) suffixParts.push(warmupReasons.join(" + "));
  const depthLabel = rangeStr
    ? `${nonNullCount} quarters · ${rangeStr}${suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : ""}`
    : `${nonNullCount} quarterly reports`;

  return (
    <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] tabular-nums text-text-tertiary md:text-[14px]">
      {cagr !== null && cagr !== undefined ? (
        <>
          <span>5Y CAGR · {formatPct(cagr, { sign: true })}</span>
          <span aria-hidden style={{ opacity: 0.4 }}>·</span>
        </>
      ) : null}
      <span>{depthLabel}</span>
      <span aria-hidden style={{ opacity: 0.4 }}>·</span>
      <span>Last reported {formatReportDate(data.lastReportedDate)}</span>
    </div>
  );
}


function ChartHeader({
  category,
  label,
  description,
  logoPath,
  brand,
  ticker,
  name,
  controls,
}: {
  category: string;
  label: string;
  description: string;
  logoPath: string | null;
  brand: string;
  ticker: string;
  name: string;
  controls?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {logoPath ? (
          // Plain img: frameless, transparent, subtle drop-shadow for contrast
          // when a brand ships a white-on-transparent mark.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoPath}
            alt={`${name} logo`}
            width={56}
            height={56}
            className="h-12 w-12 object-contain md:h-14 md:w-14"
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.10))" }}
          />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center text-[20px] font-semibold tabular-nums md:h-14 md:w-14 md:text-[24px]"
            style={{ color: brand }}
            aria-hidden="true"
          >
            {ticker.slice(0, 2)}
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-text-secondary md:text-[14px]">
            {category} <span className="px-1.5 text-text-tertiary">›</span> {label}
          </div>
          <div className="text-[14px] text-text-tertiary md:text-[15px]">{description}</div>
        </div>
      </div>
      {controls ? <div className="flex flex-wrap items-center gap-3">{controls}</div> : null}
    </div>
  );
}

function formatHoverDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function ChartTooltip({
  rows,
  format,
  currency,
  metricLabel,
  brandColor,
  secondaryColor,
  priceVisible,
  active,
  payload,
}: {
  rows: ChartRow[];
  format: MetricData["format"];
  currency: string | null;
  metricLabel: string;
  brandColor: string;
  secondaryColor: string;
  priceVisible: boolean;
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  const containerStyle = {
    background: "rgba(255, 255, 255, 0.85)",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.06)",
    transition: "transform 100ms ease-out",
  };

  // Compact tooltip for a between-quarter daily point (price only).
  if (pt.value === null) {
    if (!priceVisible || pt.price === null) return null;
    return (
      <div className="rounded-lg border border-[color:var(--hairline-soft)] px-4 py-3 backdrop-blur-lg" style={containerStyle}>
        <div className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
          {formatHoverDate(pt.date)}
        </div>
        <div className="mt-1 text-[14px] tabular-nums" style={{ color: secondaryColor }}>
          {formatLocalMoney(pt.price, currency ?? "USD")}
        </div>
      </div>
    );
  }

  // Quarter anchor — full tooltip.
  const quarterPoints = rows.filter((r) => r.value !== null);
  const idx = quarterPoints.findIndex((r) => r.date === pt.date);
  const prev = idx > 0 ? quarterPoints[idx - 1] : null;
  const yoyRef = idx >= 4 ? quarterPoints[idx - 4] : null;
  const qoq = ratio(pt.value, prev?.value);
  const yoy = ratio(pt.value, yoyRef?.value);
  const priceMove = ratio(pt.price, prev?.price);

  return (
    <div
      className="rounded-lg border border-[color:var(--hairline-soft)] px-4 py-3 backdrop-blur-lg"
      style={containerStyle}
    >
      <div className="text-[12px] uppercase tracking-[0.08em] text-text-tertiary">
        {pt.period ? formatTooltipPeriod(pt.period) : formatHoverDate(pt.date)}
      </div>
      <div className="mt-1 text-[18px] font-medium tabular-nums" style={{ color: brandColor }}>
        {formatValue(pt.value, format, currency)}
      </div>
      {priceVisible && pt.price !== null ? (
        <div className="mt-1 text-[14px] tabular-nums" style={{ color: secondaryColor }}>
          {formatLocalMoney(pt.price, currency ?? "USD")}
        </div>
      ) : null}
      <div className="mt-2 flex items-baseline gap-2 text-[13px] tabular-nums">
        <span className={TONE[toneFor(qoq)]}>{formatPct(qoq, { sign: true })}</span>
        <span className="text-text-tertiary">QoQ</span>
        <span className="px-1 text-text-tertiary">·</span>
        <span className={TONE[toneFor(yoy)]}>{formatPct(yoy, { sign: true })}</span>
        <span className="text-text-tertiary">YoY</span>
      </div>
      {priceVisible && priceMove !== null && qoq !== null ? (
        <div className="mt-1.5 text-[13px] text-text-tertiary">
          Price{" "}
          <span className={TONE[toneFor(priceMove)]}>{formatPct(priceMove, { sign: true })}</span>
          {" "}while {metricLabel.toLowerCase()}{" "}
          <span className={TONE[toneFor(qoq)]}>{formatPct(qoq, { sign: true })}</span>
        </div>
      ) : null}
    </div>
  );
}
