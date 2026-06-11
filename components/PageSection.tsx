"use client";

import { motion, useReducedMotion } from "motion/react";

import { EASE_OUT_STRONG } from "@/lib/motion";

type Props = {
  label: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/**
 * Sections reveal in once when they scroll into view. We use a generous
 * top margin (-12%) so the animation starts a beat before the section
 * is fully visible — feels like the page is leaning toward the reader
 * rather than reacting to them.
 */
export function PageSection({ label, subtitle, children, className = "" }: Props) {
  const reduced = useReducedMotion();
  const initial = reduced ? "visible" : "hidden";

  return (
    <motion.section
      className={"px-8 " + className}
      initial={initial}
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.08, when: "beforeChildren" },
        },
      }}
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 10 },
          visible: { opacity: 1, y: 0 },
        }}
        transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
        className="mb-8 flex items-baseline justify-between gap-4"
      >
        <h2 className="text-[13px] font-semibold tracking-[0.12em] uppercase text-text-secondary">
          {label}
        </h2>
        {subtitle ? (
          <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
            {subtitle}
          </span>
        ) : null}
      </motion.div>
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 12 },
          visible: { opacity: 1, y: 0 },
        }}
        transition={{ duration: 0.6, ease: EASE_OUT_STRONG }}
      >
        {children}
      </motion.div>
    </motion.section>
  );
}
