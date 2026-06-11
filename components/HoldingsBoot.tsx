"use client";

import { useEffect, useRef } from "react";

import {
  holdingsEqual,
  parseHoldingsParam,
  useHoldingsStore,
} from "@/lib/holdings";

import { SharedPortfolioBanner } from "./SharedPortfolioBanner";

type Props = {
  validTickers: string[];
};

export function HoldingsBoot({ validTickers }: Props) {
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);
  const storeHoldings = useHoldingsStore((s) => s.holdings);
  const pending = useHoldingsStore((s) => s.pendingUrlHoldings);
  const setHoldings = useHoldingsStore((s) => s.setHoldings);
  const setPersistEnabled = useHoldingsStore((s) => s.setPersistEnabled);
  const setPendingUrlHoldings = useHoldingsStore((s) => s.setPendingUrlHoldings);

  const resolvedRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated || resolvedRef.current) return;
    resolvedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const raw = params.get("holdings");
    if (!raw) return;

    const validSet = new Set(validTickers);
    const parsed = parseHoldingsParam(raw, validSet);
    if (parsed.length === 0) return;
    if (holdingsEqual(parsed, storeHoldings)) return;

    setPersistEnabled(false);
    setHoldings(parsed);
    setPendingUrlHoldings(parsed);
  }, [
    hasHydrated,
    storeHoldings,
    validTickers,
    setHoldings,
    setPersistEnabled,
    setPendingUrlHoldings,
  ]);

  if (pending === null) return null;

  const onAccept = () => {
    setPersistEnabled(true);
    setHoldings(pending);
    setPendingUrlHoldings(null);
  };

  const onDecline = () => {
    setPendingUrlHoldings(null);
  };

  return <SharedPortfolioBanner pending={pending} onAccept={onAccept} onDecline={onDecline} />;
}
