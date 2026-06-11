"use client";

import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function readInitial(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const cl = document.documentElement.classList;
  if (theme === "dark") cl.add("dark");
  else cl.remove("dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore storage errors (private mode, etc.) */
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    apply(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      apply(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
