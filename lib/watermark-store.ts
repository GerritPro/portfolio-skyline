"use client";

import { useSyncExternalStore } from "react";

export type WatermarkFormat =
  | "text"
  | "text-handle"
  | "text-url"
  | "handle"
  | "url";

export type WatermarkSettings = {
  text: string;
  handle: string;
  url: string;
  format: WatermarkFormat;
};

export const DEFAULT_SETTINGS: WatermarkSettings = {
  text: "PORTFOLIO SKYLINE",
  handle: "stocksnatcher",
  url: "",
  format: "handle",
};

// Bumped from v1 → v2 to ignore stale localStorage and pick up the new
// @stocksnatcher default. Users who'd customised theirs in v1 will see the
// new default once, then can re-set their own.
const STORAGE_KEY = "watermark_settings_v2";
const MAX_TEXT = 30;
const MAX_HANDLE = 20;
const MAX_URL = 40;

let current: WatermarkSettings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export function normalizeSettings(input: Partial<WatermarkSettings>): WatermarkSettings {
  const text = clamp((input.text ?? "").trim(), MAX_TEXT);
  const handle = clamp((input.handle ?? "").trim().replace(/^@/, ""), MAX_HANDLE);
  const url = clamp((input.url ?? "").trim().replace(/^https?:\/\//, ""), MAX_URL);
  const allowed: WatermarkFormat[] = ["text", "text-handle", "text-url", "handle", "url"];
  const format = (allowed.includes(input.format as WatermarkFormat)
    ? input.format
    : "text") as WatermarkFormat;
  return {
    text: text || DEFAULT_SETTINGS.text,
    handle,
    url,
    format,
  };
}

export function formatWatermark(s: WatermarkSettings): string {
  switch (s.format) {
    case "text-handle":
      return s.handle ? `${s.text} · @${s.handle}` : s.text;
    case "text-url":
      return s.url ? `${s.text} · ${s.url}` : s.text;
    case "handle":
      return s.handle ? `@${s.handle}` : s.text;
    case "url":
      return s.url || s.text;
    case "text":
    default:
      return s.text;
  }
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WatermarkSettings>;
      current = normalizeSettings(parsed);
    }
  } catch {
    /* ignore */
  }
}

function subscribe(cb: () => void): () => void {
  hydrate();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): WatermarkSettings {
  hydrate();
  return current;
}

function getServerSnapshot(): WatermarkSettings {
  return DEFAULT_SETTINGS;
}

export function useWatermarkSettings(): WatermarkSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setWatermarkSettings(next: Partial<WatermarkSettings>) {
  hydrate();
  current = normalizeSettings({ ...current, ...next });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

export const WATERMARK_LIMITS = {
  text: MAX_TEXT,
  handle: MAX_HANDLE,
  url: MAX_URL,
};
