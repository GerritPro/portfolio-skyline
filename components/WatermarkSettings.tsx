"use client";

import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_SETTINGS,
  formatWatermark,
  normalizeSettings,
  setWatermarkSettings,
  useWatermarkSettings,
  WATERMARK_LIMITS,
  type WatermarkFormat,
  type WatermarkSettings,
} from "@/lib/watermark-store";

const FORMAT_OPTIONS: { value: WatermarkFormat; label: string }[] = [
  { value: "text", label: "Text only" },
  { value: "text-handle", label: "Text · @Handle" },
  { value: "text-url", label: "Text · URL" },
  { value: "handle", label: "@Handle only" },
  { value: "url", label: "URL only" },
];

type Props = {
  onClose: () => void;
};

export function WatermarkSettings({ onClose }: Props) {
  const stored = useWatermarkSettings();
  const [draft, setDraft] = useState<WatermarkSettings>(stored);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = formatWatermark(normalizeSettings(draft));

  const save = () => {
    setWatermarkSettings(normalizeSettings(draft));
    onClose();
  };

  const reset = () => {
    setDraft(DEFAULT_SETTINGS);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Watermark settings"
        className="w-full max-w-md rounded-2xl border border-[color:var(--hairline-soft)] bg-bg-primary p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Watermark
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-soft hover:text-text-primary"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 2L10 10 M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <Field
            label="Watermark text"
            id="watermark-text"
            value={draft.text}
            maxLength={WATERMARK_LIMITS.text}
            placeholder="PORTFOLIO SKYLINE"
            onChange={(v) => setDraft((d) => ({ ...d, text: v }))}
          />
          <Field
            label="X / Twitter handle"
            id="watermark-handle"
            value={draft.handle}
            maxLength={WATERMARK_LIMITS.handle}
            placeholder="ellerichmann"
            onChange={(v) => setDraft((d) => ({ ...d, handle: v.replace(/^@/, "") }))}
            prefix="@"
          />
          <Field
            label="Custom URL"
            id="watermark-url"
            value={draft.url}
            maxLength={WATERMARK_LIMITS.url}
            placeholder="skyline.app"
            onChange={(v) => setDraft((d) => ({ ...d, url: v.replace(/^https?:\/\//, "") }))}
          />

          <div className="flex flex-col gap-2">
            <label
              htmlFor="watermark-format"
              className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-tertiary"
            >
              Display format
            </label>
            <select
              id="watermark-format"
              value={draft.format}
              onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value as WatermarkFormat }))}
              className="rounded-lg border border-[color:var(--hairline-soft)] bg-bg-soft px-3 py-2 text-[14px] text-text-primary outline-none focus:border-[color:var(--accent-blue)]"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
              Preview
            </span>
            <div className="flex h-16 items-end justify-end rounded-lg border border-[color:var(--hairline-faint)] bg-bg-soft px-6 pb-3">
              <span
                aria-hidden
                className="text-[9px] uppercase tracking-[0.16em] text-text-tertiary"
                style={{ opacity: 0.7 }}
              >
                {preview}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={reset}
            className="text-[13px] font-medium text-text-tertiary transition-colors hover:text-text-primary"
          >
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-full bg-text-primary px-4 py-2 text-[13px] font-medium text-[color:var(--bg-primary)] transition-opacity hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  value,
  maxLength,
  placeholder,
  onChange,
  prefix,
}: {
  label: string;
  id: string;
  value: string;
  maxLength: number;
  placeholder?: string;
  onChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-tertiary"
        >
          {label}
        </label>
        <span className="text-[11px] tabular-nums text-text-tertiary">
          {value.length} / {maxLength}
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-[color:var(--hairline-soft)] bg-bg-soft px-3 py-2 focus-within:border-[color:var(--accent-blue)]">
        {prefix ? (
          <span className="text-[14px] text-text-tertiary">{prefix}</span>
        ) : null}
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
    </div>
  );
}
