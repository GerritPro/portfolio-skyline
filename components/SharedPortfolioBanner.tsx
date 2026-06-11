"use client";

import type { Holding } from "@/lib/holdings";

import { SectionLabel } from "./SectionLabel";

type Props = {
  pending: Holding[];
  onAccept: () => void;
  onDecline: () => void;
};

export function SharedPortfolioBanner({ pending, onAccept, onDecline }: Props) {
  const count = pending.length;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed left-1/2 top-6 z-50 -translate-x-1/2"
    >
      <div className="surface-elevated flex items-center gap-5 px-5 py-3">
        <div className="flex flex-col">
          <SectionLabel>Shared portfolio</SectionLabel>
          <span className="mt-0.5 text-[14px] tabular-nums text-text-primary">
            Loaded {count} position{count === 1 ? "" : "s"} from URL. Save as your own?
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDecline}
            className="rounded-full bg-bg-soft px-3.5 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-divider hover:text-text-primary"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-full bg-accent-blue px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[color:var(--accent-blue-hover)]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
