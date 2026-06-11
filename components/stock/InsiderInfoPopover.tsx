"use client";

import { useEffect, useRef, useState } from "react";

export function InsiderInfoPopover() {
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
        aria-label="What is insider activity?"
        aria-expanded={open}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[color:var(--hairline-soft)] text-[10px] font-medium text-text-tertiary transition-colors duration-150 ease-out hover:border-text-secondary hover:text-text-primary"
      >
        i
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-6 z-20 w-[340px] rounded-lg border border-[color:var(--hairline-soft)] bg-bg-secondary px-4 py-3 text-[13px] leading-relaxed text-text-secondary"
          style={{ boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)" }}
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Insider Activity
          </div>
          <p className="mb-2">
            Form 4 filings disclose trades by officers, directors, and 10%
            shareholders within 2 business days.
          </p>
          <p className="mb-2">
            <span className="font-medium text-text-primary">P</span> =
            open-market purchase ·{" "}
            <span className="font-medium text-text-primary">S</span> = open-market
            sale ·{" "}
            <span className="font-medium text-text-primary">A</span> = award /
            grant (filtered out — compensation).
          </p>
          <p className="mb-2">
            <span className="font-medium text-text-primary">10b5-1 plans</span>{" "}
            are pre-scheduled and mechanical, not a discretionary signal. They
            appear de-emphasized in the list.
          </p>
          <p>
            <span className="font-medium text-text-primary">Cluster signal</span>{" "}
            fires when 3+ insiders bought in a 14-day window — historically a
            stronger indicator than any single trade.
          </p>
        </div>
      ) : null}
    </div>
  );
}
