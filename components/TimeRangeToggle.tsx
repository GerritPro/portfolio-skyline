"use client";

export type RangeKey = "1Y" | "3Y" | "5Y" | "10Y" | "ALL";

const RANGES: RangeKey[] = ["1Y", "3Y", "5Y", "10Y", "ALL"];

const RANGE_QUARTERS: Record<RangeKey, number> = {
  "1Y": 4,
  "3Y": 12,
  "5Y": 20,
  "10Y": 40,
  ALL: Infinity,
};

export function sliceQuarters<T>(arr: T[], range: RangeKey): T[] {
  const n = RANGE_QUARTERS[range];
  if (!Number.isFinite(n)) return arr;
  return arr.slice(Math.max(0, arr.length - n));
}

type Props = {
  value: RangeKey;
  onChange: (v: RangeKey) => void;
};

export function TimeRangeToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-full bg-bg-soft p-0.5">
      {RANGES.map((r) => {
        const selected = r === value;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium tabular-nums transition-colors duration-150 ease-out " +
              (selected
                ? "bg-bg-secondary text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary")
            }
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}
