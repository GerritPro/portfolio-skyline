"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { HEATMAP_DIAGONAL, correlationColor, correlationTextColor } from "@/lib/chart-colors";
import type { Correlations } from "@/lib/types";

import { Watermark } from "../Watermark";

type Props = {
  // Lazy-loaded client-side. Server used to serialize a 500x500 float
  // matrix as a Server-to-Client prop, costing ~10s in cold-cache SSR.
  filterTickers?: string[] | null;
};

let cachedCorrelations: Correlations | null = null;
let inflight: Promise<Correlations> | null = null;

async function loadCorrelations(): Promise<Correlations> {
  if (cachedCorrelations) return cachedCorrelations;
  if (inflight) return inflight;
  inflight = fetch("/data/correlations.json")
    .then((r) => r.json() as Promise<Correlations>)
    .then((data) => {
      cachedCorrelations = data;
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function CorrelationHeatmapCard({ filterTickers }: Props) {
  const router = useRouter();
  const openPanelFor = (ticker: string) => router.push(`/stock/${ticker}`);
  const [hovered, setHovered] = useState<{ i: number; j: number } | null>(null);
  const [correlations, setCorrelations] = useState<Correlations | null>(cachedCorrelations);

  useEffect(() => {
    if (correlations) return;
    let cancelled = false;
    loadCorrelations().then((data) => {
      if (!cancelled) setCorrelations(data);
    }).catch(() => {/* silent */});
    return () => {
      cancelled = true;
    };
  }, [correlations]);

  const { tickers, matrix } = useMemo(() => {
    if (!correlations) return { tickers: [] as string[], matrix: [] as number[][] };
    if (!filterTickers || filterTickers.length === 0) {
      return { tickers: correlations.tickers, matrix: correlations.matrix };
    }
    const indexByTicker = new Map(correlations.tickers.map((t, i) => [t, i]));
    const keep: { ticker: string; idx: number }[] = [];
    for (const t of filterTickers) {
      const i = indexByTicker.get(t);
      if (i !== undefined) keep.push({ ticker: t, idx: i });
    }
    const sub = keep.map((k) => k.ticker);
    const subMatrix = keep.map((row) => keep.map((col) => correlations.matrix[row.idx][col.idx]));
    return { tickers: sub, matrix: subMatrix };
  }, [correlations, filterTickers]);

  if (!correlations) {
    return (
      <div className="h-[280px] w-full animate-pulse rounded bg-bg-soft" />
    );
  }

  if (tickers.length === 0) {
    return (
      <p className="caption">
        Add at least 2 holdings to see pairwise correlations.
      </p>
    );
  }
  if (tickers.length === 1) {
    return (
      <p className="caption">
        Need at least 2 holdings for a correlation matrix — currently {tickers.length}.
      </p>
    );
  }

  const hoveredRho =
    hovered !== null && matrix[hovered.i] ? matrix[hovered.i][hovered.j] : null;

  // Cell size scales with holdings count: small portfolios get bigger cells,
  // large portfolios get more compact ones. Clamped to keep values readable.
  const cellMin = tickers.length <= 4 ? 80 : tickers.length <= 8 ? 64 : 48;
  const cellMax = tickers.length <= 4 ? 110 : tickers.length <= 8 ? 88 : 72;

  return (
    <div className="relative flex flex-col gap-8">
        <div className="overflow-x-auto">
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `48px repeat(${tickers.length}, minmax(${cellMin}px, ${cellMax}px))`,
              gridTemplateRows: `28px repeat(${tickers.length}, minmax(${cellMin}px, ${cellMax}px))`,
            }}
          >
            <div />
            {tickers.map((t, i) => (
              <button
                key={`col-${i}`}
                onClick={() => openPanelFor(t)}
                className="text-[12px] font-semibold uppercase tracking-[0.04em] text-text-secondary transition-colors hover:text-text-primary"
              >
                {t}
              </button>
            ))}
            {tickers.map((rowT, i) => (
              <Fragment key={`row-${i}`}>
                <button
                  onClick={() => openPanelFor(rowT)}
                  className="pr-2 text-right text-[12px] font-semibold uppercase tracking-[0.04em] text-text-secondary transition-colors hover:text-text-primary"
                >
                  {rowT}
                </button>
                {tickers.map((_, j) => {
                  const rho = matrix[i][j];
                  const isDiag = i === j;
                  const isHover = hovered?.i === i && hovered?.j === j;
                  const isRowOrCol =
                    hovered !== null && (hovered.i === i || hovered.j === j) && !isHover;
                  const cellBg = isDiag ? HEATMAP_DIAGONAL : correlationColor(rho);
                  const textColor = isDiag ? "var(--text-tertiary)" : correlationTextColor(rho);
                  // Diagonal gets a subtle 45-deg stripe pattern so it reads
                  // as "same series" rather than "no data".
                  const diagPattern = isDiag
                    ? "repeating-linear-gradient(45deg, rgba(0,0,0,0.03) 0 2px, transparent 2px 6px)"
                    : undefined;
                  return (
                    <div
                      key={`cell-${i}-${j}`}
                      onMouseEnter={() => setHovered({ i, j })}
                      onMouseLeave={() => setHovered(null)}
                      className={
                        "relative flex items-center justify-center rounded-sm transition-[transform,box-shadow] duration-150 ease-out " +
                        (isHover ? "scale-105 ring-1 ring-[color:rgb(0_113_227_/_0.3)]" : "") +
                        (isRowOrCol ? " ring-1 ring-[color:var(--hairline-soft)]" : "")
                      }
                      style={{
                        backgroundColor: cellBg,
                        backgroundImage: diagPattern,
                      }}
                      title={`${tickers[i]} × ${tickers[j]}: ${rho.toFixed(2)}`}
                    >
                      <span
                        className="text-[12px] font-medium tabular-nums"
                        style={{ color: textColor }}
                      >
                        {rho.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-[13px] text-text-tertiary">
            <span className="tabular-nums">−1</span>
            <div
              className="h-2 flex-1 rounded-sm"
              style={{
                background:
                  "linear-gradient(90deg, #E5484D 0%, #FBFBFD 50%, #0071E3 100%)",
              }}
            />
            <span className="tabular-nums">+1</span>
          </div>
          <div className="flex h-4 items-center justify-center text-[13px]">
            <span className="font-medium tabular-nums text-text-primary">
              {hovered !== null && hoveredRho !== null
                ? `${tickers[hovered.i]} × ${tickers[hovered.j]} = ${hoveredRho.toFixed(2)}`
                : ""}
            </span>
          </div>
        </div>
        <Watermark className="absolute right-4 bottom-2" />
    </div>
  );
}
