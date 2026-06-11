"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Profile } from "@/lib/types";

type Props = {
  tickerProfiles: Profile[];
};

const MAX_SUGGESTIONS = 8;

export function StockSearchBar({ tickerProfiles }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q === "") return tickerProfiles.slice(0, MAX_SUGGESTIONS);
    const exact: Profile[] = [];
    const prefix: Profile[] = [];
    const nameMatch: Profile[] = [];
    for (const p of tickerProfiles) {
      const tk = p.ticker.toUpperCase();
      const nm = p.name.toUpperCase();
      if (tk === q) exact.push(p);
      else if (tk.startsWith(q)) prefix.push(p);
      else if (nm.includes(q)) nameMatch.push(p);
    }
    return [...exact, ...prefix, ...nameMatch].slice(0, MAX_SUGGESTIONS);
  }, [query, tickerProfiles]);

  const go = (ticker: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/stock/${ticker}`);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[Math.min(activeIdx, suggestions.length - 1)];
      if (pick) go(pick.ticker);
    }
  };

  return (
    <div className="border-b border-[color:var(--hairline-soft)] px-8 py-3">
      <div ref={wrapRef} className="relative mx-auto max-w-xl">
        <div className="flex items-center gap-2 rounded-full bg-bg-soft px-4 py-2">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-text-tertiary">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            placeholder="Search ticker or name…"
            className="flex-1 bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-tertiary"
            aria-label="Search the universe"
          />
          <span className="hidden text-[12px] uppercase tracking-[0.08em] text-text-tertiary sm:inline">
            {tickerProfiles.length} stocks · ⌘K
          </span>
        </div>

        {open && suggestions.length > 0 ? (
          <ul className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[360px] overflow-y-auto rounded-xl border border-[color:var(--hairline-soft)] bg-bg-primary py-2 shadow-lg">
            {suggestions.map((p, i) => (
              <li key={p.ticker}>
                <Link
                  href={`/stock/${p.ticker}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  className={
                    "flex items-baseline justify-between gap-3 px-4 py-2 transition-colors " +
                    (i === activeIdx ? "bg-bg-soft" : "hover:bg-bg-soft")
                  }
                >
                  <span className="inline-flex items-baseline gap-3">
                    <span className="min-w-[64px] text-[14px] font-semibold tabular-nums text-text-primary">
                      {p.ticker}
                    </span>
                    <span className="text-[14px] text-text-secondary">{p.name}</span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
                    {p.sector ?? ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
