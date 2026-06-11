"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { EASE_OUT_STRONG } from "@/lib/motion";
import type { LensId } from "@/lib/lenses";

type Props = {
  active: LensId;
  direction: number;
  children: React.ReactNode;
};

const SHIFT = 28;

/**
 * Animates the lens content panel as the user switches tabs. Direction
 * (+1 = moving right, -1 = moving left) is passed through `custom` so
 * the enter/exit transforms slide in the same direction the user's
 * "moving" in their mental map of lenses.
 */
export function LensView({ active, direction, children }: Props) {
  const reduced = useReducedMotion();
  const variants = reduced
    ? {
        enter: { opacity: 0 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        enter: (d: number) => ({ x: d * SHIFT, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (d: number) => ({ x: -d * SHIFT, opacity: 0 }),
      };

  return (
    <div className="relative">
      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.div
          key={active}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.35, ease: EASE_OUT_STRONG }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
