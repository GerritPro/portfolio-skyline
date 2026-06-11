export type MetricKey =
  | "pe"
  | "revenue"
  | "net_income"
  | "eps"
  | "gross_margin"
  | "op_margin"
  | "net_margin"
  | "roe"
  | "roa"
  | "roic"
  | "fcf"
  | "insider";

export type MetricFormat = "currency" | "percent" | "perShare" | "ratio";

export type MetricMeta = {
  key: MetricKey;
  label: string;
  category: string;
  format: MetricFormat;
  description: string;
};

export const METRICS: Record<MetricKey, MetricMeta> = {
  pe: { key: "pe", label: "P/E", category: "Valuation", format: "ratio", description: "Price divided by trailing twelve-month earnings per share" },
  revenue: { key: "revenue", label: "Revenue", category: "Growth", format: "currency", description: "Total income from sales before any costs are deducted" },
  net_income: { key: "net_income", label: "Net Income", category: "Growth", format: "currency", description: "Profit after all expenses, taxes, interest, and depreciation" },
  eps: { key: "eps", label: "EPS", category: "Growth", format: "perShare", description: "Net income divided by diluted shares outstanding" },
  gross_margin: { key: "gross_margin", label: "Gross Margin", category: "Profitability", format: "percent", description: "Gross profit as a percentage of revenue" },
  op_margin: { key: "op_margin", label: "Op Margin", category: "Profitability", format: "percent", description: "Operating profit as percentage of revenue, before interest and taxes" },
  net_margin: { key: "net_margin", label: "Net Margin", category: "Profitability", format: "percent", description: "Net profit as a percentage of revenue" },
  roe: { key: "roe", label: "ROE", category: "Returns", format: "percent", description: "Net income divided by shareholders' equity" },
  roa: { key: "roa", label: "ROA", category: "Returns", format: "percent", description: "Net income divided by total assets" },
  roic: { key: "roic", label: "ROIC", category: "Returns", format: "percent", description: "After-tax operating profit divided by invested capital" },
  fcf: { key: "fcf", label: "Free Cash Flow", category: "Quality", format: "currency", description: "Operating cash flow minus capital expenditures" },
  insider: { key: "insider", label: "Insider Activity", category: "Ownership", format: "currency", description: "Open-market buys and sales by company officers and directors" },
};

export const CATEGORIES: { key: string; label: string; metrics: MetricKey[] }[] = [
  { key: "valuation", label: "Valuation", metrics: ["pe"] },
  { key: "growth", label: "Growth", metrics: ["revenue", "net_income", "eps"] },
  { key: "profitability", label: "Profitability", metrics: ["gross_margin", "op_margin", "net_margin"] },
  { key: "returns", label: "Returns", metrics: ["roe", "roa", "roic"] },
  { key: "quality", label: "Quality", metrics: ["fcf"] },
  { key: "ownership", label: "Ownership", metrics: ["insider"] },
];

export function isMetricKey(v: string): v is MetricKey {
  return v in METRICS;
}
