"use client";

import { useMemo } from "react";

import { motion, useReducedMotion } from "motion/react";

import { grayByRank } from "@/lib/chart-colors";
import { colors } from "@/lib/design-tokens";
import { formatPct } from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";
import { EASE_OUT_STRONG } from "@/lib/motion";
import { sectorBreakdown, valueByTicker } from "@/lib/portfolio-stats";
import { colorForSector } from "@/lib/sector-colors";

import { AnimatedBar } from "../AnimatedBar";

type Props = {
  lastCloseByTicker: Record<string, number>;
  sectorByTicker: Record<string, string | null>;
  useSectorColors?: boolean;
};

export function SectorExposureCard({
  lastCloseByTicker,
  sectorByTicker,
  useSectorColors = false,
}: Props) {
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const holdings = useHoldingsStore((s) => s.holdings);

  const isPortfolio = holdings.length > 0 && hasHydrated;

  const breakdown = useMemo(() => {
    if (!isPortfolio) return [];
    const values = valueByTicker(holdings, lastCloseByTicker);
    return sectorBreakdown(holdings, values, sectorByTicker);
  }, [isPortfolio, holdings, lastCloseByTicker, sectorByTicker]);

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          Sector Exposure
        </h3>
        <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
          by portfolio value
        </span>
      </div>
      {breakdown.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">
          Add holdings to see your sector mix.
        </p>
      ) : (
        <StaggeredList>
          {breakdown.map((b, idx) => {
            const color = useSectorColors
              ? colorForSector(b.sector)
              : breakdown.length === 1 ? colors.accentBlue : grayByRank(idx);
            return (
              <motion.li
                key={b.sector}
                className="flex flex-col gap-2"
                variants={ROW_VARIANTS}
                transition={{ duration: 0.4, ease: EASE_OUT_STRONG }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-medium tracking-tight text-text-primary">
                    {b.sector}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums text-text-primary">
                    {formatPct(b.weight, { digits: 0 })}
                  </span>
                </div>
                <AnimatedBar
                  value={b.weight}
                  color={color}
                  height={6}
                  ariaLabel={`${b.sector} weight`}
                />
              </motion.li>
            );
          })}
        </StaggeredList>
      )}
    </div>
  );
}

const ROW_VARIANTS = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
};

function StaggeredList({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.ul
      className="flex flex-col gap-4"
      initial={reduced ? "visible" : "hidden"}
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.05 } },
      }}
    >
      {children}
    </motion.ul>
  );
}
