import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { FxSchema, type Fx } from "./types";

export type StockMetadata = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  currency: string | null;
  price: number | null;
  return1d: number | null;
  return1m: number | null;
  return1y: number | null;
  return5y: number | null;
  currentPe: number | null;
  lastUpdate: string;
  brand_color?: string | null;
  logo_path?: string | null;
  quartersAvailable?: number | null;
  provider?: string | null;
};

const STOCKS_DIR = path.join(process.cwd(), "public", "data", "stocks");

export async function loadStockMetadata(ticker: string): Promise<StockMetadata | null> {
  const safe = ticker.replace(/[^A-Z0-9.-]/gi, "");
  if (safe.length === 0) return null;
  const file = path.join(STOCKS_DIR, safe.toUpperCase(), "metadata.json");
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as StockMetadata;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/** Single-file aggregated brand-color map. Falls back to the per-ticker
 *  metadata.json read if the aggregate file isn't there yet. */
export async function loadBrandColorMap(tickers: string[]): Promise<Record<string, string>> {
  const aggFile = path.join(process.cwd(), "public", "data", "brand_colors.json");
  try {
    const raw = await readFile(aggFile, "utf-8");
    const parsed = JSON.parse(raw) as { brand?: Record<string, string> };
    if (parsed && typeof parsed.brand === "object" && parsed.brand !== null) {
      return parsed.brand;
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    // Aggregate file missing → fall through to per-ticker read.
  }

  const entries = await Promise.all(
    tickers.map(async (t) => {
      const meta = await loadStockMetadata(t);
      const c = meta?.brand_color;
      return typeof c === "string" && c.length > 0 ? ([t, c] as const) : null;
    }),
  );
  const out: Record<string, string> = {};
  for (const e of entries) {
    if (e) out[e[0]] = e[1];
  }
  return out;
}

export type SegmentHistoryPoint = {
  period: string;
  value: number | null;
};

export type SegmentSeries = {
  name: string;
  label: string;
  history: SegmentHistoryPoint[];
};

export type StockSegments = {
  axisType: string;
  axisLabel: string;
  axis: string;
  periods: string[];
  segments: SegmentSeries[];
  generatedAt?: string;
};

export async function loadStockSegments(ticker: string): Promise<StockSegments | null> {
  const safe = ticker.replace(/[^A-Z0-9.-]/gi, "");
  if (!safe) return null;
  const file = path.join(STOCKS_DIR, safe.toUpperCase(), "segments.json");
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as StockSegments;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export type LastUpdateStamps = {
  prices?: string;
  fundamentals?: string;
  japan?: string;
};

export async function loadLastUpdate(): Promise<LastUpdateStamps> {
  const file = path.join(process.cwd(), "public", "data", "last_update.json");
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as LastUpdateStamps;
    }
    return {};
  } catch {
    return {};
  }
}

export async function loadFx(): Promise<Fx | null> {
  const file = path.join(process.cwd(), "public", "data", "fx.json");
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = FxSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}
