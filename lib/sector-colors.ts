const SECTOR_COLORS: Record<string, string> = {
  // yfinance canonical sector names (used by Yahoo Finance backend)
  Technology: "#4A90E2",
  Healthcare: "#50C878",
  "Financial Services": "#B0BEC5",
  "Consumer Cyclical": "#FF8A65",
  "Consumer Defensive": "#A1887F",
  Energy: "#FFB74D",
  Industrials: "#90A4AE",
  "Basic Materials": "#BCAAA4",
  Utilities: "#64B5F6",
  "Real Estate": "#81C784",
  "Communication Services": "#BA68C8",
};

// Aliases for FMP / alternative provider sector labels.
const ALIASES: Record<string, string> = {
  "Information Technology": "Technology",
  Financials: "Financial Services",
  "Consumer Discretionary": "Consumer Cyclical",
  "Consumer Staples": "Consumer Defensive",
  Materials: "Basic Materials",
  "Health Care": "Healthcare",
};

const FALLBACK = "#666666";

export function colorForSector(sector: string | null | undefined): string {
  if (!sector) return FALLBACK;
  const canonical = ALIASES[sector] ?? sector;
  return SECTOR_COLORS[canonical] ?? FALLBACK;
}

export function normalizeSector(sector: string | null | undefined): string | null {
  if (!sector) return null;
  return ALIASES[sector] ?? sector;
}
