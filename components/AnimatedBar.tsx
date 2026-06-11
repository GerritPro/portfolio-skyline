"use client";

import { motion, useReducedMotion } from "motion/react";

import { EASE_OUT_STRONG } from "@/lib/motion";

type Props = {
  /** Fractional width 0..1. */
  value: number;
  /** Bar color (CSS color). */
  color: string;
  /** Background track color. Default: var(--bg-card-soft). */
  trackColor?: string;
  /** Bar thickness in pixels. Default 6. */
  height?: number;
  /** Rounded corners — full pill by default. */
  rounded?: boolean;
  /** Optional aria-label for screen readers. */
  ariaLabel?: string;
  className?: string;
};

/**
 * GPU-accelerated horizontal bar — uses `scaleX` from origin-left rather
 * than animating `width`, so it stays on the compositor thread and
 * coordinates cleanly with staggered parent variants.
 *
 * The track is always full-width; the fill scales from 0 to `value`.
 */
export function AnimatedBar({
  value,
  color,
  trackColor = "var(--bg-card-soft)",
  height = 6,
  rounded = true,
  ariaLabel,
  className,
}: Props) {
  const reduced = useReducedMotion();
  const safe = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  // A barely-visible starting state. Emil's rule: nothing in the real
  // world appears from nothing. `0.001` keeps the bar invisible without
  // collapsing the transform-origin math.
  const initial = reduced ? safe : 0.001;

  return (
    <div
      role={ariaLabel ? "progressbar" : undefined}
      aria-label={ariaLabel}
      aria-valuenow={Math.round(safe * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={"relative w-full overflow-hidden " + (rounded ? "rounded-full " : "") + (className ?? "")}
      style={{ height, backgroundColor: trackColor }}
    >
      <motion.div
        className={"absolute inset-y-0 left-0 w-full" + (rounded ? " rounded-full" : "")}
        style={{
          backgroundColor: color,
          transformOrigin: "left center",
          // willChange opt-in so the compositor allocates a layer up
          // front; cheap because the bar is small.
          willChange: "transform",
        }}
        initial={{ scaleX: initial }}
        animate={{ scaleX: safe }}
        transition={{ duration: 0.6, ease: EASE_OUT_STRONG }}
      />
    </div>
  );
}
