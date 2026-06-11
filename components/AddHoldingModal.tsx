"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useHoldingsStore } from "@/lib/holdings";
import type { Profile } from "@/lib/types";

import { SectionLabel } from "./SectionLabel";

type Props = {
  onClose: () => void;
  tickerProfiles: Profile[];
};

const MAX_SUGGESTIONS = 8;

export function AddHoldingModal({ onClose, tickerProfiles }: Props) {
  const add = useHoldingsStore((s) => s.add);
  const persistEnabled = useHoldingsStore((s) => s.persistEnabled);
  const holdings = useHoldingsStore((s) => s.holdings);

  const [query, setQuery] = useState<string>("");
  const [shares, setShares] = useState<string>("");
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const validByTicker = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of tickerProfiles) map.set(p.ticker, p);
    return map;
  }, [tickerProfiles]);

  const heldSet = useMemo(() => new Set(holdings.map((h) => h.ticker)), [holdings]);

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q === "") return tickerProfiles.slice(0, MAX_SUGGESTIONS);
    const out: Profile[] = [];
    for (const p of tickerProfiles) {
      if (p.ticker.startsWith(q) || p.name.toUpperCase().includes(q)) {
        out.push(p);
        if (out.length >= MAX_SUGGESTIONS) break;
      }
    }
    return out;
  }, [query, tickerProfiles]);

  const tickerCandidate = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q !== "" && validByTicker.has(q)) return q;
    if (suggestions.length > 0)
      return suggestions[Math.min(activeIdx, suggestions.length - 1)].ticker;
    return null;
  }, [query, validByTicker, suggestions, activeIdx]);

  const sharesNumber = Number(shares);
  const sharesValid = shares.trim() !== "" && Number.isFinite(sharesNumber) && sharesNumber > 0;
  const canSubmit = tickerCandidate !== null && sharesValid;

  const onSubmit = () => {
    if (!canSubmit || tickerCandidate === null) return;
    add(tickerCandidate, sharesNumber);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="surface-elevated w-[400px] overflow-hidden">
        <div className="border-b divider-hairline px-6 pt-5 pb-3">
          <p className="title">Add holding</p>
        </div>
        <div className="flex flex-col gap-5 px-6 py-5">
          <div>
            <label htmlFor="add-ticker">
              <SectionLabel as="span">Ticker</SectionLabel>
            </label>
            <input
              id="add-ticker"
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (suggestions[activeIdx]) setQuery(suggestions[activeIdx].ticker);
                }
              }}
              placeholder="AAPL"
              className="mt-2 w-full rounded-lg border border-divider bg-bg-secondary px-3.5 py-2.5 text-[15px] font-semibold uppercase tabular-nums tracking-tight text-text-primary outline-none transition-colors focus:border-accent-blue focus:ring-2 focus:ring-[color:var(--accent-blue-soft)]"
            />
            {suggestions.length > 0 ? (
              <ul className="mt-2 max-h-[180px] overflow-y-auto rounded-lg border divider-hairline">
                {suggestions.map((p, i) => {
                  const isActive = i === activeIdx;
                  const isHeld = heldSet.has(p.ticker);
                  return (
                    <li
                      key={p.ticker}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => {
                        setQuery(p.ticker);
                        setActiveIdx(i);
                      }}
                      className={
                        "flex cursor-pointer items-baseline justify-between gap-3 px-3.5 py-2 text-[13px] " +
                        (isActive
                          ? "bg-[color:var(--accent-blue-soft)] text-text-primary"
                          : "text-text-secondary hover:bg-bg-soft")
                      }
                    >
                      <span className="font-semibold tracking-tight text-text-primary">
                        {p.ticker}
                      </span>
                      <span className="flex-1 truncate text-[14px] text-text-tertiary">
                        {p.name}
                      </span>
                      {isHeld ? (
                        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
                          held
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-2 rounded-lg border divider-hairline px-3.5 py-2.5 caption">
                No match in universe.
              </div>
            )}
          </div>
          <div>
            <label htmlFor="add-shares">
              <SectionLabel as="span">Shares</SectionLabel>
            </label>
            <input
              id="add-shares"
              type="number"
              min="0"
              step="any"
              autoComplete="off"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmit();
              }}
              placeholder="10"
              className="mt-2 w-full rounded-lg border border-divider bg-bg-secondary px-3.5 py-2.5 text-[15px] tabular-nums text-text-primary outline-none transition-colors focus:border-accent-blue focus:ring-2 focus:ring-[color:var(--accent-blue-soft)]"
            />
          </div>
          {!persistEnabled ? (
            <div className="rounded-lg bg-bg-soft px-3.5 py-2.5 text-[13px] text-text-secondary">
              Session only · changes won&apos;t be saved.
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2.5 border-t divider-hairline px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-bg-soft px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-divider hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className={
              "rounded-full px-4 py-2 text-[13px] font-medium transition-colors " +
              (canSubmit
                ? "bg-accent-blue text-white hover:bg-[color:var(--accent-blue-hover)]"
                : "cursor-not-allowed bg-bg-soft text-text-tertiary")
            }
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
