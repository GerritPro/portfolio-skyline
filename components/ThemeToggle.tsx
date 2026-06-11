"use client";

import { useEffect, useState } from "react";

import { useTheme } from "@/lib/use-theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  // Avoid hydration mismatch: the server can't know which theme the
  // inline bootstrap script applied, so we render a stable placeholder
  // icon during SSR and swap to the real toggle after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        mounted
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Toggle theme"
      }
      title={
        mounted
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Toggle theme"
      }
      className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-soft hover:text-text-primary"
      // Suppress hydration warning on attributes that depend on
      // mounted state — content is stable; only labels differ.
      suppressHydrationWarning
    >
      {isDark ? (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle cx="7" cy="7" r="3" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="7" y1="0.8" x2="7" y2="2.2" />
            <line x1="7" y1="11.8" x2="7" y2="13.2" />
            <line x1="0.8" y1="7" x2="2.2" y2="7" />
            <line x1="11.8" y1="7" x2="13.2" y2="7" />
            <line x1="2.6" y1="2.6" x2="3.6" y2="3.6" />
            <line x1="10.4" y1="10.4" x2="11.4" y2="11.4" />
            <line x1="2.6" y1="11.4" x2="3.6" y2="10.4" />
            <line x1="10.4" y1="3.6" x2="11.4" y2="2.6" />
          </g>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path
            d="M11.5 8.3a4.6 4.6 0 0 1-5.8-5.8 5 5 0 1 0 5.8 5.8z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
