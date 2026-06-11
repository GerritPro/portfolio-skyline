"use client";

import { motion, useReducedMotion } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

const FADE_UP = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

export function AnimateStack({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? "visible" : "hidden"}
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function AnimateItem({
  children,
  className,
  duration = 0.4,
}: {
  children: React.ReactNode;
  className?: string;
  duration?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={FADE_UP}
      transition={{ duration, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export { EASE, FADE_UP };
