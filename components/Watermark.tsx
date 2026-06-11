"use client";

import { formatWatermark, useWatermarkSettings } from "@/lib/watermark-store";

type Props = {
  className?: string;
};

/** Minimalist geometric fox-head mark. Triangle ears on top, wide cheeks,
 *  narrowing snout. Coloured via currentColor so the parent decides the
 *  hue (we pin it to a fixed blue below). */
function FoxIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      style={{ display: "block" }}
    >
      <path d="M2 3.5 L7.5 5 L9 9 L15 9 L16.5 5 L22 3.5 L20 13 L17 18 L12 21 L7 18 L4 13 Z" />
      <path d="M9.5 11 L11 13.5 L12 14.5 L13 13.5 L14.5 11" fill="none" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
    </svg>
  );
}

/** Caption-level branding text, rendered as a watermark on chart cards.
 *  Reads from the watermark store so it updates live when the user edits
 *  settings — no page refresh needed. */
export function Watermark({ className }: Props) {
  const settings = useWatermarkSettings();
  const text = formatWatermark(settings);
  return (
    <span
      aria-hidden
      className={
        "pointer-events-none inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] " +
        (className ?? "")
      }
      style={{ color: "var(--accent-blue)", opacity: 0.65 }}
    >
      <FoxIcon />
      <span>{text}</span>
    </span>
  );
}
