"use client";

import type { MetricViewKey } from "@/lib/metric-fetch";

const VIEWS: { key: MetricViewKey; label: string }[] = [
  { key: "ttm", label: "TTM" },
  { key: "quarterly", label: "Quarterly" },
];

type Props = {
  value: MetricViewKey;
  onChange: (v: MetricViewKey) => void;
};

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-full bg-bg-soft p-0.5">
      {VIEWS.map((v) => {
        const selected = v.key === value;
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => onChange(v.key)}
            className={
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ease-out " +
              (selected
                ? "bg-bg-secondary text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary")
            }
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
