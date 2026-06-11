import Link from "next/link";

import { formatPct, toneFor } from "@/lib/format";
import type { Profile } from "@/lib/types";

type Props = {
  tickerProfiles: Profile[];
  return1dByTicker: Record<string, number | null>;
};

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-state-positive",
  negative: "text-state-negative",
  neutral: "text-text-tertiary",
};

export function UniverseNav({ tickerProfiles, return1dByTicker }: Props) {
  return (
    <nav
      aria-label="Stocks"
      className="border-b border-[color:var(--hairline-soft)] px-8 py-3"
    >
      <ul className="flex flex-wrap items-baseline gap-x-1 gap-y-1">
        {tickerProfiles.map((p) => {
          const r = return1dByTicker[p.ticker] ?? null;
          const tone = toneFor(r);
          return (
            <li key={p.ticker}>
              <Link
                href={`/stock/${p.ticker}`}
                className="group inline-flex items-baseline gap-2 rounded-full px-3 py-1.5 transition-colors duration-150 ease-out hover:bg-bg-soft"
              >
                <span className="text-[13px] font-semibold tracking-tight tabular-nums text-text-primary">
                  {p.ticker}
                </span>
                {r !== null ? (
                  <span className={"text-[11px] tabular-nums " + TONE[tone]}>
                    {formatPct(r, { sign: true })}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
