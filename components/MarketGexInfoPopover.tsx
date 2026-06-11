"use client";

import { useEffect, useRef, useState } from "react";

export function MarketGexInfoPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="What is GEX?"
        aria-expanded={open}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[color:var(--hairline-soft)] text-[10px] font-medium text-text-tertiary transition-colors duration-150 ease-out hover:border-text-secondary hover:text-text-primary"
      >
        i
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-6 z-20 w-[320px] rounded-lg border border-[color:var(--hairline-soft)] bg-bg-secondary px-4 py-3 text-[13px] leading-relaxed text-text-secondary"
          style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)" }}
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Gamma Exposure (GEX)
          </div>
          <p className="mb-2">
            GEX summarizes how SPY options dealers must hedge their book.
          </p>
          <p className="mb-2">
            <span className="font-medium text-text-primary">Negative GEX</span>:
            dealers are net short gamma. As price rises they buy more —
            amplifying rallies; as price falls they sell — amplifying drawdowns.
          </p>
          <p className="mb-2">
            <span className="font-medium text-text-primary">Positive GEX</span>:
            dealers are net long gamma. They sell into rallies and buy dips,
            dampening volatility.
          </p>
          <p>
            <span className="font-medium text-text-primary">Flip level</span>{" "}
            marks where the regime switches. Call/Put walls are strike clusters
            where hedging pressure tends to pin price.
          </p>
        </div>
      ) : null}
    </div>
  );
}
