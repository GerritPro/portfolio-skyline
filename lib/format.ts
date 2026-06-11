export function formatMoney(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const compact = opts?.compact ?? false;
  if (compact || v >= 1e9) {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  }
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${v.toFixed(2)}`;
}

export function formatPct(v: number | null | undefined, opts?: { sign?: boolean; digits?: number }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const digits = opts?.digits ?? 2;
  const pct = v * 100;
  const sign = opts?.sign && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

export function formatPe(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(1);
}

export function formatZ(z: number | null | undefined): string {
  if (z === null || z === undefined || !Number.isFinite(z)) return "—";
  if (z === 0) return "—";
  const sign = z > 0 ? "+" : "";
  return `${sign}${z.toFixed(2)}σ`;
}

export function toneFor(v: number | null | undefined): "positive" | "negative" | "neutral" {
  if (v === null || v === undefined || !Number.isFinite(v)) return "neutral";
  if (v > 0) return "positive";
  if (v < 0) return "negative";
  return "neutral";
}

export function formatCompactMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatRatio(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatEps(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  CHF: "CHF ",
  CAD: "C$",
  AUD: "A$",
};

export function symbolFor(currency: string | null | undefined): string {
  if (!currency) return "$";
  const u = currency.toUpperCase();
  return CURRENCY_SYMBOLS[u] ?? `${u} `;
}

export function formatLocalMoney(
  v: number | null | undefined,
  currency: string | null | undefined,
  opts?: { compact?: boolean },
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sym = symbolFor(currency);
  const ccy = (currency ?? "").toUpperCase();
  const compact = opts?.compact ?? false;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (compact || abs >= 1e9) {
    if (abs >= 1e12) return `${sign}${sym}${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
  }
  const noCents = ccy === "JPY" || ccy === "HKD";
  return `${sign}${sym}${abs.toLocaleString("en-US", {
    maximumFractionDigits: noCents ? 0 : 2,
    minimumFractionDigits: noCents ? 0 : 2,
  })}`;
}

export type FxRates = { rates: Record<string, number> };

export function convertToEur(
  value: number | null | undefined,
  fromCurrency: string | null | undefined,
  fx: FxRates | null,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const ccy = (fromCurrency ?? "USD").toUpperCase();
  if (ccy === "EUR") return value;
  if (!fx) return null;
  const rate = fx.rates[ccy];
  if (!rate || !Number.isFinite(rate)) return null;
  return value * rate;
}
