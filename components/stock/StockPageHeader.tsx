import Link from "next/link";

import { colors, rgba } from "@/lib/design-tokens";
import type { StockMetadata } from "@/lib/stock-data-loader";

import { AddToPortfolioPill } from "./AddToPortfolioPill";

type Props = {
  metadata: StockMetadata;
};

export function StockPageHeader({ metadata }: Props) {
  return (
    <header className="flex items-start justify-between gap-6 border-b border-[color:var(--hairline-soft)] px-8 py-6">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <span className="text-[32px] font-semibold tracking-tight tabular-nums text-text-primary">
            {metadata.ticker}
          </span>
          <span className="truncate text-[17px] text-text-secondary">{metadata.name}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {metadata.sector ? (
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium"
              style={{
                backgroundColor: rgba(colors.accentBlue, 0.1),
                color: colors.accentBlue,
              }}
            >
              {metadata.sector}
            </span>
          ) : null}
          {metadata.currency ? (
            <span className="inline-flex items-center rounded-full bg-bg-soft px-3 py-1 text-[12px] font-medium uppercase tracking-[0.04em] text-text-secondary">
              {metadata.currency}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <AddToPortfolioPill ticker={metadata.ticker} />
        <Link
          href="/"
          aria-label="Close stock view"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-soft hover:text-text-primary"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M2 2L12 12 M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
