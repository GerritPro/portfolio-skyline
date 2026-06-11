"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MarketGex, MarketGexProfilePoint } from "@/lib/types";

import { Watermark } from "./Watermark";

type Props = {
  data: MarketGex;
};

function formatStrike(s: number): string {
  return `$${s.toFixed(0)}`;
}

function formatGex(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function nearest(value: number, candidates: number[]): number | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDiff = Math.abs(value - best);
  for (const c of candidates) {
    const d = Math.abs(value - c);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  return best;
}

export function MarketGexChart({ data }: Props) {
  // Bound the displayed range to spot ± 12% to keep bars legible.
  const visible = useMemo<MarketGexProfilePoint[]>(() => {
    const lo = data.spy_spot * 0.88;
    const hi = data.spy_spot * 1.12;
    return data.profile
      .filter((p) => p.strike >= lo && p.strike <= hi)
      .sort((a, b) => a.strike - b.strike);
  }, [data.profile, data.spy_spot]);

  const strikes = visible.map((p) => p.strike);
  const spotStrike = nearest(data.spy_spot, strikes);
  const flipStrike =
    data.flip_level !== null ? nearest(data.flip_level, strikes) : null;

  if (visible.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-[13px] text-text-tertiary">
        No GEX strikes in the displayed range.
      </div>
    );
  }

  return (
    <div className="relative h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={visible}
          margin={{ top: 16, right: 64, bottom: 16, left: 48 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="strike"
            tickFormatter={(s: number) =>
              s % 10 === 0 ? formatStrike(s) : ""
            }
            tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={0}
            width={48}
          />
          <Tooltip
            cursor={false}
            wrapperStyle={{ outline: "none" }}
            content={<GexTooltip />}
          />
          {spotStrike !== null ? (
            <ReferenceLine
              y={spotStrike}
              stroke="var(--accent-blue)"
              strokeWidth={1.5}
              label={{
                value: `SPY ${formatStrike(data.spy_spot)}`,
                position: "right",
                fill: "var(--accent-blue)",
                fontSize: 10,
                offset: 8,
              }}
            />
          ) : null}
          {flipStrike !== null ? (
            <ReferenceLine
              y={flipStrike}
              stroke="var(--divider)"
              strokeWidth={1}
              strokeDasharray="2 4"
              label={{
                value: `Flip ${formatStrike(data.flip_level ?? 0)}`,
                position: "right",
                fill: "var(--text-tertiary)",
                fontSize: 10,
                offset: 8,
              }}
            />
          ) : null}
          <Bar dataKey="gex_total" isAnimationActive={false}>
            {visible.map((p) => {
              const isCallWall =
                data.call_wall !== null && p.strike === data.call_wall.strike;
              const isPutWall =
                data.put_wall !== null && p.strike === data.put_wall.strike;
              const fill =
                p.gex_total >= 0
                  ? isCallWall
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)"
                  : isPutWall
                    ? "var(--text-primary)"
                    : "var(--text-secondary)";
              return (
                <Cell key={`bar-${p.strike}`} fill={fill} />
              );
            })}
          </Bar>
          {data.call_wall !== null ? (
            <ReferenceLine
              y={data.call_wall.strike}
              stroke="transparent"
              label={{
                value: "CALL WALL",
                position: "right",
                fill: "var(--text-tertiary)",
                fontSize: 9,
                offset: 8,
              }}
            />
          ) : null}
          {data.put_wall !== null ? (
            <ReferenceLine
              y={data.put_wall.strike}
              stroke="transparent"
              label={{
                value: "PUT WALL",
                position: "right",
                fill: "var(--text-tertiary)",
                fontSize: 9,
                offset: 8,
              }}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
      <Watermark className="absolute right-3 bottom-1" />
    </div>
  );
}

function GexTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MarketGexProfilePoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  return (
    <div
      className="rounded-lg border border-[color:var(--hairline-soft)] px-3 py-2 text-[11px] backdrop-blur-md"
      style={{
        background: "rgba(255, 255, 255, 0.85)",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.06)",
      }}
    >
      <div className="font-semibold tabular-nums text-text-primary">
        {formatStrike(pt.strike)}
      </div>
      <div className="mt-0.5 tabular-nums text-text-tertiary">
        GEX <span className="text-text-primary">{formatGex(pt.gex_total)}</span>
      </div>
    </div>
  );
}
