"use client";

import { useState } from "react";

import { buildShareUrl, useHoldingsStore } from "@/lib/holdings";
import type { LastUpdateStamps } from "@/lib/stock-data-loader";
import type { Metadata } from "@/lib/types";

import { FreshnessBadge } from "./FreshnessBadge";
import { RefreshButton } from "./RefreshButton";
import { ThemeToggle } from "./ThemeToggle";
import { UpdateStamps } from "./UpdateStamps";
import { WatermarkSettings } from "./WatermarkSettings";

type Props = {
  metadata: Metadata;
  universeCount: number;
  sectorCount: number;
  lastUpdate?: LastUpdateStamps;
};

export function AppHeader({ metadata, universeCount, sectorCount, lastUpdate }: Props) {
  const holdings = useHoldingsStore((s) => s.holdings);
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const [copied, setCopied] = useState(false);
  const [watermarkOpen, setWatermarkOpen] = useState(false);

  const onShare = async () => {
    const url = buildShareUrl(holdings);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this URL to share:", url);
    }
  };

  return (
    <header className="flex items-center justify-between gap-6 border-b divider-hairline bg-bg-primary/80 px-8 py-4 backdrop-blur-md">
      <div className="flex items-baseline gap-6">
        <div className="flex items-baseline gap-2.5">
          <span
            aria-hidden
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #0071E3 0%, #5E8CFF 100%)" }}
          >
            ◐
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-text-primary">
            Portfolio Skyline
          </span>
        </div>
        <span className="caption tabular-nums">
          <span className="font-medium text-text-primary">{universeCount}</span> stocks
          <span className="px-1.5 text-text-tertiary">·</span>
          <span className="font-medium text-text-primary">{sectorCount}</span> sectors
          <span className="px-1.5 text-text-tertiary">·</span>
          mode <span className="font-medium text-text-primary">{metadata.mode.toLowerCase()}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        {lastUpdate && (lastUpdate.prices || lastUpdate.fundamentals || lastUpdate.japan) ? (
          <span className="hidden lg:inline">
            <UpdateStamps stamps={lastUpdate} />
          </span>
        ) : null}
        <FreshnessBadge asOf={metadata.data_version} generatedAt={metadata.generated_at} />
        <RefreshButton />
        <ThemeToggle />
        <button
          type="button"
          onClick={() => setWatermarkOpen(true)}
          aria-label="Watermark settings"
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-soft hover:text-text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm0-3.5l.6 1.7 1.8.3-.6 1.7L11 7l-1.5 1.1.4 1.8L8 9.2l-1.9.7.4-1.8L5 7l1.2-1.3-.6-1.7 1.8-.3z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={onShare}
          disabled={!hasHydrated}
          className="rounded-full bg-[color:var(--accent-blue-soft)] px-4 py-1.5 text-[13px] font-medium text-accent-blue transition-[colors,transform] duration-150 ease-out hover:scale-[1.02] hover:bg-accent-blue hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? "Copied" : "Share"}
        </button>
      </div>
      {watermarkOpen ? <WatermarkSettings onClose={() => setWatermarkOpen(false)} /> : null}
    </header>
  );
}
