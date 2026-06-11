import { z } from "zod";

const isoDate = z.string();
const isoTimestamp = z.string();

export const ProviderModeSchema = z.enum(["hybrid", "yfinance", "fmp"]);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

const ProfileSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  market_cap: z.number().nullable(),
  country: z.string().nullable(),
  exchange: z.string().nullable(),
  logo_url: z.string().nullable(),
  currency: z.string().nullable().optional(),
  source: z.object({ profile: z.string() }),
});

export const UniverseSchema = z.object({
  version: z.number(),
  generated_at: isoTimestamp,
  tickers: z.array(ProfileSchema),
});
export type Universe = z.infer<typeof UniverseSchema>;
export type Profile = z.infer<typeof ProfileSchema>;

const PriceBlockSchema = z.object({
  source: z.string(),
  fetched_at: isoTimestamp,
  dates: z.array(isoDate),
  close: z.array(z.number()),
  volume: z.array(z.number()),
});

export const PricesSchema = z.object({
  version: z.number(),
  generated_at: isoTimestamp,
  range: z.object({
    start: isoDate.nullable(),
    end: isoDate.nullable(),
  }),
  data: z.record(z.string(), PriceBlockSchema),
});
export type Prices = z.infer<typeof PricesSchema>;
export type PriceBlock = z.infer<typeof PriceBlockSchema>;

const FundamentalsQuarterSchema = z.object({
  period: z.string(),
  fiscal_date_ending: isoDate,
  revenue: z.number().nullable(),
  net_income: z.number().nullable(),
  eps: z.number().nullable(),
  shares_outstanding: z.number().nullable(),
  free_cash_flow: z.number().nullable(),
  total_debt: z.number().nullable(),
  cash: z.number().nullable(),
  operating_margin: z.number().nullable(),
  gross_profit: z.number().nullable().optional(),
  operating_income: z.number().nullable().optional(),
  total_assets: z.number().nullable().optional(),
  total_equity: z.number().nullable().optional(),
});

const FundamentalsBlockSchema = z.object({
  source: z.string(),
  fetched_at: isoTimestamp,
  quarters: z.array(FundamentalsQuarterSchema),
  peers: z.object({
    source: z.string(),
    tickers: z.array(z.string()),
  }),
  derived: z.record(z.string(), z.unknown()),
});

export const FundamentalsSchema = z.object({
  version: z.number(),
  generated_at: isoTimestamp,
  data: z.record(z.string(), FundamentalsBlockSchema),
});
export type Fundamentals = z.infer<typeof FundamentalsSchema>;
export type FundamentalsBlock = z.infer<typeof FundamentalsBlockSchema>;
export type FundamentalsQuarter = z.infer<typeof FundamentalsQuarterSchema>;

export const CorrelationsSchema = z.object({
  version: z.number(),
  generated_at: isoTimestamp,
  as_of: isoDate,
  window_days: z.number(),
  tickers: z.array(z.string()),
  matrix: z.array(z.array(z.number())),
});
export type Correlations = z.infer<typeof CorrelationsSchema>;

const SectorBlockSchema = z.object({
  weighted_market_cap: z.number().nullable(),
  median_rev_growth_yoy: z.number().nullable(),
});

export const SectorsSchema = z.object({
  version: z.number(),
  generated_at: isoTimestamp,
  as_of: isoDate,
  sectors: z.record(z.string(), SectorBlockSchema),
});
export type Sectors = z.infer<typeof SectorsSchema>;

export const InsiderTransactionSchema = z.object({
  filing_date: z.string(),
  trade_date: z.string(),
  insider_name: z.string(),
  title: z.string(),
  type: z.string(),
  shares: z.number(),
  price: z.number().nullable(),
  value: z.number().nullable(),
  is_10b51: z.boolean(),
});
export type InsiderTransaction = z.infer<typeof InsiderTransactionSchema>;

export const InsiderSummarySchema = z.object({
  net_buy_sell_90d: z.number(),
  insider_count_90d: z.number(),
  cluster_signal: z.boolean(),
  latest_activity: z.string().nullable(),
});
export type InsiderSummary = z.infer<typeof InsiderSummarySchema>;

export const InsiderDataSchema = z.object({
  ticker: z.string(),
  as_of: z.string(),
  fetched_at: z.string().optional(),
  source: z.string(),
  summary: InsiderSummarySchema,
  transactions: z.array(InsiderTransactionSchema),
});
export type InsiderData = z.infer<typeof InsiderDataSchema>;

export const FxSchema = z.object({
  version: z.number(),
  as_of: z.string(),
  fetched_at: z.string().optional(),
  base: z.string(),
  rates: z.record(z.string(), z.number()),
  history: z
    .record(
      z.string(),
      z.array(z.object({ date: z.string(), rate: z.number() })),
    )
    .optional(),
});
export type Fx = z.infer<typeof FxSchema>;

export const MarketGexProfilePointSchema = z.object({
  strike: z.number(),
  gex_total: z.number(),
  gex_call: z.number().optional(),
  gex_put: z.number().optional(),
});

export const MarketGexSchema = z.object({
  version: z.number(),
  as_of: z.string(),
  fetched_at: z.string(),
  spy_spot: z.number(),
  risk_free_rate: z.number(),
  aggregate_gex: z.number(),
  flip_level: z.number().nullable(),
  call_wall: z.object({ strike: z.number(), gex: z.number() }).nullable(),
  put_wall: z.object({ strike: z.number(), gex: z.number() }).nullable(),
  profile: z.array(MarketGexProfilePointSchema),
  expirations_used: z.array(z.string()),
});
export type MarketGex = z.infer<typeof MarketGexSchema>;
export type MarketGexProfilePoint = z.infer<typeof MarketGexProfilePointSchema>;

export const RiskFactorSchema = z.object({
  alpha: z.number(),
  beta_market: z.number(),
  beta_sector: z.number(),
  idio_std: z.number(),
  r2: z.number(),
  sector: z.string().nullable(),
  n: z.number(),
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const RiskFactorsSchema = z.object({
  version: z.number(),
  generated_at: isoTimestamp,
  as_of: isoDate.nullable(),
  window_days: z.number(),
  market_var: z.number(),
  market_std: z.number(),
  sector_var: z.record(z.string(), z.number()),
  factors: z.record(z.string(), RiskFactorSchema),
});
export type RiskFactors = z.infer<typeof RiskFactorsSchema>;

export const MetadataSchema = z.object({
  version: z.number(),
  generated_at: isoTimestamp,
  data_version: isoDate,
  ticker_count: z.number(),
  mode: ProviderModeSchema,
  providers: z.record(z.string(), z.record(z.string(), z.number())),
  fmp_calls_used_today: z.number(),
  fmp_quota_daily: z.number(),
  next_quarterly_due: isoDate,
  git_sha: z.string().nullable(),
});
export type Metadata = z.infer<typeof MetadataSchema>;

export type PipelineData = {
  universe: Universe;
  prices: Prices;
  fundamentals: Fundamentals;
  correlations: Correlations;
  sectors: Sectors;
  metadata: Metadata;
  fx: Fx | null;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export class PipelineValidationError extends Error {
  readonly file: string;
  readonly issues: ValidationIssue[];

  constructor(file: string, issues: ValidationIssue[]) {
    super(`Validation failed for ${file} (${issues.length} issue${issues.length === 1 ? "" : "s"})`);
    this.name = "PipelineValidationError";
    this.file = file;
    this.issues = issues;
  }
}

export class PipelineMissingError extends Error {
  readonly file: string;

  constructor(file: string) {
    super(`Pipeline output missing: ${file}`);
    this.name = "PipelineMissingError";
    this.file = file;
  }
}
