/**
 * Motion tokens + small hooks. Mirrors the CSS easing variables in
 * globals.css so JS-driven animations stay visually consistent with
 * CSS transitions across the app.
 */
"use client";

import { useEffect, useRef } from "react";
import { animate, useMotionValue, useTransform, type MotionValue } from "motion/react";

// Strong custom curves — the built-in `ease-out` / `ease-in-out` lack
// the punch that makes UI animations feel intentional.
export const EASE_OUT_STRONG = [0.23, 1, 0.32, 1] as const;
export const EASE_IN_OUT_STRONG = [0.77, 0, 0.175, 1] as const;

// Standard durations. Keep UI animations under 300ms.
export const DURATION = {
  press: 0.12,
  hover: 0.18,
  reveal: 0.5,
  number: 0.9,
} as const;

/**
 * Animate a numeric value smoothly. Returns a MotionValue holding the
 * latest interpolated number (with the requested rounding). Useful for
 * count-up / count-down displays on hero metrics. Render via:
 *
 *   <motion.span>{display}</motion.span>
 *
 * (motion components subscribe to MotionValue children without
 * re-rendering React.)
 */
export function useAnimatedNumber(
  target: number,
  opts?: {
    duration?: number;
    decimals?: number;
    locale?: string;
    /** Suppress the animation on first paint (useful for SSR-stable values). */
    skipFirst?: boolean;
  },
): MotionValue<string> {
  const duration = opts?.duration ?? DURATION.number;
  const decimals = opts?.decimals ?? 0;
  const locale = opts?.locale ?? "en-US";
  const skipFirst = opts?.skipFirst ?? false;

  const value = useMotionValue(skipFirst ? target : 0);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (skipFirst && isFirstRun.current) {
      isFirstRun.current = false;
      value.set(target);
      return;
    }
    isFirstRun.current = false;
    const controls = animate(value, target, {
      duration,
      ease: EASE_OUT_STRONG,
    });
    return () => controls.stop();
  }, [target, duration, value, skipFirst]);

  return useTransform(value, (v) =>
    v.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  );
}
