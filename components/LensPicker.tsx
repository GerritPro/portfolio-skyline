"use client";

import { useEffect } from "react";

import { motion, useReducedMotion } from "motion/react";

import { LENSES, type LensId } from "@/lib/lenses";
import { EASE_OUT_STRONG } from "@/lib/motion";

type Props = {
  active: LensId;
  onSelect: (id: LensId) => void;
};

/**
 * Horizontal segmented control. Uses motion's `layoutId` so the active
 * pill smoothly slides between tabs when you click. Keyboard
 * navigation: arrow keys + 1–6 jump straight to a lens.
 */
export function LensPicker({ active, onSelect }: Props) {
  const reduced = useReducedMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      // Number keys 1–6 jump to the matching lens.
      if (e.key >= "1" && e.key <= String(LENSES.length)) {
        const idx = parseInt(e.key, 10) - 1;
        if (LENSES[idx]) {
          e.preventDefault();
          onSelect(LENSES[idx].id);
        }
        return;
      }

      // Arrow keys move left/right through lenses.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const idx = LENSES.findIndex((l) => l.id === active);
        if (idx < 0) return;
        const next = e.key === "ArrowRight" ? idx + 1 : idx - 1;
        if (next >= 0 && next < LENSES.length) {
          e.preventDefault();
          onSelect(LENSES[next].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onSelect]);

  return (
    <div className="sticky top-0 z-30 bg-bg-primary/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 overflow-x-auto px-4 py-4 sm:px-8">
        <div
          role="tablist"
          aria-label="Dashboard lenses"
          className="relative inline-flex rounded-full border border-[color:var(--hairline-soft)] bg-bg-secondary p-1 shadow-[var(--shadow-card)]"
        >
          {LENSES.map((lens, idx) => {
            const isActive = lens.id === active;
            return (
              <button
                key={lens.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(lens.id)}
                title={`${lens.label} — ${lens.caption} (${idx + 1})`}
                className={
                  "relative z-10 inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-200 active:scale-[0.97] " +
                  (isActive
                    ? "text-text-primary"
                    : "text-text-secondary hover:text-text-primary")
                }
                style={{
                  transitionTimingFunction:
                    "var(--ease-out-strong, cubic-bezier(0.23, 1, 0.32, 1))",
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="lens-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-[color:var(--bg-card-soft)] ring-1 ring-[color:var(--hairline-soft)]"
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 500, damping: 40, mass: 0.8 }
                    }
                  />
                )}
                <span>{lens.label}</span>
                {lens.badge === "new" ? (
                  <span className="rounded-full bg-[color:var(--accent-blue-soft)] px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-accent-blue">
                    new
                  </span>
                ) : lens.badge === "soon" ? (
                  <span className="rounded-full bg-[color:var(--bg-card-soft)] px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                    soon
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <motion.span
          key={active}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT_STRONG }}
          className="ml-2 hidden truncate text-[12px] text-text-tertiary lg:inline"
        >
          {LENSES.find((l) => l.id === active)?.caption}
        </motion.span>
        <span
          aria-hidden
          className="ml-auto hidden text-[10px] uppercase tracking-[0.08em] text-text-tertiary lg:inline"
        >
          ← → · 1–{LENSES.length}
        </span>
      </div>
    </div>
  );
}
