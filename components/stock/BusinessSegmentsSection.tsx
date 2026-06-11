"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatLocalMoney, formatPct } from "@/lib/format";
import type { StockSegments } from "@/lib/stock-data-loader";

import { Watermark } from "../Watermark";

type Props = {
  segments: StockSegments;
  currency?: string | null;
};

// Twelve high-contrast Apple-palette tints rotated for stacked-area segments.
// First five align with the most common Apple breakdown (iPhone, Services, etc.)
// for visual familiarity.
const SEGMENT_PALETTE = [
  "#5b8def", // brand blue (iPhone-ish)
  "#9b72cf", // services purple
  "#7fbf7f", // green
  "#e07a5f", // orange
  "#3a86b3", // teal
  "#d97757", // burnt
  "#74cfca", // mint
  "#b58a5b", // tan
  "#c47ab2", // pink
  "#9d8a6e", // olive
  "#7895c1", // slate
  "#b5895a", // bronze
];

function formatTooltipPeriod(period: string): string {
  const [year, q] = period.split("-Q");
  if (!year || !q) return period;
  return `Q${q} ${year}`;
}

type Row = Record<string, number | string | null>;

export function BusinessSegmentsSection({ segments, currency }: Props) {
  const ccy = currency ?? "USD";
  const [hovered, setHovered] = useState<string | null>(null);

  // Stack rows: { period, [segmentName]: value, ... }
  const { rows, totalLastPeriod, totalPrevPeriod } = useMemo(() => {
    const rows: Row[] = segments.periods.map((period) => {
      const r: Row = { period };
      for (const s of segments.segments) {
        const pt = s.history.find((h) => h.period === period);
        r[s.name] = pt?.value ?? null;
      }
      return r;
    });
    const sumFor = (row: Row | undefined) => {
      if (!row) return 0;
      let s = 0;
      for (const seg of segments.segments) {
        const v = row[seg.name];
        if (typeof v === "number" && Number.isFinite(v)) s += v;
      }
      return s;
    };
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    return {
      rows,
      totalLastPeriod: sumFor(last),
      totalPrevPeriod: sumFor(prev),
    };
  }, [segments]);

  // Pull the segment with biggest +/- YoY growth for the auto-insight line.
  const insight = useMemo(() => {
    if (segments.periods.length < 5) return null;
    const lastPeriod = segments.periods[segments.periods.length - 1];
    const yoyPeriodGuess = findYoyPeriod(segments.periods, lastPeriod);
    if (!yoyPeriodGuess) return null;
    const items: { name: string; label: string; growth: number }[] = [];
    for (const s of segments.segments) {
      const cur = s.history.find((h) => h.period === lastPeriod)?.value;
      const ref = s.history.find((h) => h.period === yoyPeriodGuess)?.value;
      if (typeof cur === "number" && typeof ref === "number" && ref > 0) {
        items.push({ name: s.name, label: s.label, growth: cur / ref - 1 });
      }
    }
    if (items.length === 0) return null;
    items.sort((a, b) => b.growth - a.growth);
    const top = items[0];
    const bottom = items[items.length - 1];
    return { top, bottom, lastPeriod, yoyPeriod: yoyPeriodGuess, total: items.length };
  }, [segments]);

  const segmentMap = useMemo(() => {
    const m = new Map<string, { label: string; color: string }>();
    segments.segments.forEach((s, i) => {
      m.set(s.name, { label: s.label, color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length] });
    });
    return m;
  }, [segments]);

  // Current-quarter table rows: { label, current, prev, yoyRef, color }
  const tableRows = useMemo(() => {
    const lastP = segments.periods[segments.periods.length - 1];
    const prevP = segments.periods[segments.periods.length - 2];
    const yoyP = findYoyPeriod(segments.periods, lastP);
    return segments.segments
      .map((s, i) => {
        const cur = s.history.find((h) => h.period === lastP)?.value ?? null;
        const prev = prevP ? s.history.find((h) => h.period === prevP)?.value ?? null : null;
        const yoy = yoyP ? s.history.find((h) => h.period === yoyP)?.value ?? null : null;
        return {
          name: s.name,
          label: s.label,
          color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
          current: cur,
          prev,
          yoy,
        };
      })
      .sort((a, b) => (b.current ?? 0) - (a.current ?? 0));
  }, [segments]);

  if (segments.segments.length === 0 || segments.periods.length < 2) return null;

  return (
    <section className="relative flex flex-col gap-6 border-t border-[color:var(--hairline-soft)] pt-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Business Segments
          </h2>
          <p className="text-[15px] text-text-tertiary">
            Revenue split by {segments.axisLabel.toLowerCase()} segment, from SEC XBRL filings.
          </p>
        </div>
        <div className="flex items-baseline gap-3 text-[13px] tabular-nums text-text-tertiary">
          <span>
            Latest period:{" "}
            <span className="text-text-primary">
              {formatTooltipPeriod(segments.periods[segments.periods.length - 1])}
            </span>
          </span>
          <span aria-hidden style={{ opacity: 0.4 }}>·</span>
          <span>
            Total{" "}
            <span className="text-text-primary">
              {formatLocalMoney(totalLastPeriod, ccy, { compact: true })}
            </span>
            {totalPrevPeriod > 0 ? (
              <>
                {" "}
                <span
                  className={
                    totalLastPeriod >= totalPrevPeriod
                      ? "text-state-positive"
                      : "text-state-negative"
                  }
                >
                  ({formatPct(totalLastPeriod / totalPrevPeriod - 1, { sign: true })})
                </span>
              </>
            ) : null}
          </span>
        </div>
      </header>

      {insight ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px] text-text-secondary">
          <span style={{ color: segmentMap.get(insight.top.name)?.color ?? "var(--text-primary)" }}>●</span>
          <span>
            <span className="font-semibold text-text-primary">{insight.top.label}</span>{" "}
            grew{" "}
            <span className="font-semibold text-state-positive">
              {formatPct(insight.top.growth, { sign: true })} YoY
            </span>
          </span>
          {insight.bottom.name !== insight.top.name ? (
            <>
              <span aria-hidden className="px-2 text-text-tertiary" style={{ opacity: 0.4 }}>·</span>
              <span style={{ color: segmentMap.get(insight.bottom.name)?.color ?? "var(--text-primary)" }}>●</span>
              <span>
                <span className="font-semibold text-text-primary">{insight.bottom.label}</span>{" "}
                <span
                  className={
                    insight.bottom.growth >= 0
                      ? "font-semibold text-state-positive"
                      : "font-semibold text-state-negative"
                  }
                >
                  {formatPct(insight.bottom.growth, { sign: true })} YoY
                </span>
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="relative h-[360px] w-full rounded-lg bg-[color:var(--bg-soft)]/30">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 24, right: 24, bottom: 32, left: 16 }}>
            <defs>
              {segments.segments.map((s, i) => (
                <linearGradient
                  key={s.name}
                  id={`seg-${s.name}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]}
                    stopOpacity={0.95}
                  />
                  <stop
                    offset="100%"
                    stopColor={SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]}
                    stopOpacity={0.7}
                  />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="period"
              tickFormatter={(p: string) => {
                const [, q] = p.split("-Q");
                const year = p.split("-Q")[0];
                return q === "1" ? year : "";
              }}
              tick={{ fill: "var(--text-secondary)", fontSize: 13 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis hide />
            <Tooltip
              cursor={{ stroke: "var(--divider)", strokeWidth: 1 }}
              content={
                <SegmentsTooltip
                  currency={ccy}
                  segmentMap={segmentMap}
                  segments={segments}
                  setHovered={setHovered}
                  hovered={hovered}
                />
              }
              wrapperStyle={{ outline: "none" }}
              offset={12}
            />
            {segments.segments.map((s, i) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stackId="seg"
                stroke={SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]}
                strokeWidth={1.5}
                fill={`url(#seg-${s.name})`}
                fillOpacity={1}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-col">
        <div className="grid grid-cols-[1fr_120px_72px_72px] gap-3 border-b border-[color:var(--hairline-soft)] pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          <span>Segment</span>
          <span className="text-right">Latest</span>
          <span className="text-right">QoQ</span>
          <span className="text-right">YoY</span>
        </div>
        <ul className="flex flex-col divide-y divide-[color:var(--hairline-faint)]">
          {tableRows.map((row) => {
            const qoq =
              typeof row.current === "number" && typeof row.prev === "number" && row.prev > 0
                ? row.current / row.prev - 1
                : null;
            const yoy =
              typeof row.current === "number" && typeof row.yoy === "number" && row.yoy > 0
                ? row.current / row.yoy - 1
                : null;
            return (
              <li
                key={row.name}
                className="grid grid-cols-[1fr_120px_72px_72px] items-baseline gap-3 py-2.5 text-[14px] tabular-nums"
              >
                <span className="inline-flex items-center gap-2 text-text-primary">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span className="font-medium">{row.label}</span>
                </span>
                <span className="text-right text-text-primary">
                  {row.current === null ? "—" : formatLocalMoney(row.current, ccy, { compact: true })}
                </span>
                <span
                  className={
                    "text-right " +
                    (qoq === null ? "text-text-tertiary" : qoq >= 0 ? "text-state-positive" : "text-state-negative")
                  }
                >
                  {qoq === null ? "—" : formatPct(qoq, { sign: true })}
                </span>
                <span
                  className={
                    "text-right " +
                    (yoy === null ? "text-text-tertiary" : yoy >= 0 ? "text-state-positive" : "text-state-negative")
                  }
                >
                  {yoy === null ? "—" : formatPct(yoy, { sign: true })}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Watermark below the table so it never overlaps any segment row. */}
      <div className="flex justify-end pt-2">
        <Watermark />
      </div>
    </section>
  );
}

function findYoyPeriod(periods: string[], lastPeriod: string): string | null {
  // Pull e.g. "2026-Q1" → match "2025-Q1".
  const [yearStr, qPart] = lastPeriod.split("-Q");
  if (!yearStr || !qPart) return null;
  const targetYear = parseInt(yearStr, 10) - 1;
  const candidate = `${targetYear}-Q${qPart}`;
  return periods.includes(candidate) ? candidate : null;
}

function SegmentsTooltip({
  active,
  payload,
  currency,
  segmentMap,
  segments,
  hovered,
  setHovered,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Row; dataKey?: string; value?: number }>;
  currency: string;
  segmentMap: Map<string, { label: string; color: string }>;
  segments: StockSegments;
  hovered: string | null;
  setHovered: (v: string | null) => void;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  // Sum total for this period.
  let total = 0;
  for (const seg of segments.segments) {
    const v = pt[seg.name];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  const rows = segments.segments
    .map((s) => {
      const v = pt[s.name];
      return {
        name: s.name,
        label: s.label,
        value: typeof v === "number" ? v : null,
        color: segmentMap.get(s.name)?.color ?? "var(--text-primary)",
      };
    })
    .filter((r) => r.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  // suppress lint unused warning
  void hovered;
  void setHovered;
  return (
    <div
      className="rounded-lg border border-[color:var(--hairline-soft)] px-4 py-3 backdrop-blur-lg"
      style={{
        background: "rgba(255, 255, 255, 0.92)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)",
      }}
    >
      <div className="text-[12px] uppercase tracking-[0.08em] text-text-tertiary">
        {formatTooltipPeriod(String(pt.period))}
      </div>
      <div className="mt-1 text-[15px] font-medium tabular-nums text-text-primary">
        {formatLocalMoney(total, currency, { compact: true })}
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {rows.map((r) => (
          <li
            key={r.name}
            className="flex items-baseline justify-between gap-4 text-[13px] tabular-nums"
          >
            <span className="inline-flex items-baseline gap-2">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: r.color }}
              />
              <span className="text-text-secondary">{r.label}</span>
            </span>
            <span className="text-text-primary">
              {r.value !== null ? formatLocalMoney(r.value, currency, { compact: true }) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
