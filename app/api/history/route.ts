/**
 * GET /api/history?tickers=AAPL,MSFT&range=1Y
 *
 * Serves slim, date-aligned daily close series for the requested tickers
 * plus the FX history needed to convert them to EUR. The heavy
 * prices.json (50MB+) never leaves the server — we keep a trimmed copy
 * in memory and hand the client only the columns it asked for, aligned
 * onto one master date axis with forward-fill.
 *
 * The portfolio equity curve itself is computed client-side (see
 * lib/performance.ts) because share counts live in client state; this
 * route is a pure price/FX provider so it stays cacheable and reusable.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type SlimBlock = { dates: string[]; close: number[] };
type SlimPrices = {
  end: string;
  byTicker: Record<string, SlimBlock>;
};

type FxHistory = {
  /** EUR per 1 unit of currency, per date (ascending). */
  history: Record<string, { date: string; rate: number }[]>;
  rates: Record<string, number>;
};

const DATA_DIR = path.join(process.cwd(), "public", "data");
const MAX_TICKERS = 60;
const MAX_POINTS = 800;

const RANGES = ["1M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"] as const;
type RangeKey = (typeof RANGES)[number];

const RANGE_DAYS: Record<RangeKey, number> = {
  "1M": 31,
  "6M": 186,
  YTD: -1, // sentinel — handled specially
  "1Y": 372,
  "3Y": 1115,
  "5Y": 1858,
  MAX: Infinity,
};

// Module-level caches. Parsing 50MB on every request would be brutal; we
// keep the trimmed structures alive for the life of the dev/server
// process. HMR clears the module on source edits.
let pricesCache: Promise<SlimPrices> | null = null;
let fxCache: Promise<FxHistory> | null = null;

async function loadPrices(): Promise<SlimPrices> {
  if (pricesCache) return pricesCache;
  pricesCache = (async () => {
    const raw = await readFile(path.join(DATA_DIR, "prices.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      range: { end: string | null };
      data: Record<string, { dates: string[]; close: number[] }>;
    };
    const byTicker: Record<string, SlimBlock> = {};
    let end = parsed.range?.end ?? "";
    for (const [ticker, block] of Object.entries(parsed.data)) {
      if (!block?.dates?.length || !block?.close?.length) continue;
      byTicker[ticker] = { dates: block.dates, close: block.close };
      const last = block.dates[block.dates.length - 1];
      if (last > end) end = last;
    }
    return { end, byTicker };
  })();
  return pricesCache;
}

async function loadFx(): Promise<FxHistory> {
  if (fxCache) return fxCache;
  fxCache = (async () => {
    try {
      const raw = await readFile(path.join(DATA_DIR, "fx.json"), "utf-8");
      const parsed = JSON.parse(raw) as {
        history?: Record<string, { date: string; rate: number }[]>;
        rates?: Record<string, number>;
      };
      return { history: parsed.history ?? {}, rates: parsed.rates ?? {} };
    } catch {
      return { history: {}, rates: {} };
    }
  })();
  return fxCache;
}

function parseTickers(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of raw.split(",")) {
    const t = seg.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

function isRange(v: string | null): v is RangeKey {
  return v !== null && (RANGES as readonly string[]).includes(v);
}

/** Subtract `days` from an ISO yyyy-mm-dd string, returning yyyy-mm-dd. */
function minusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function cutoffFor(range: RangeKey, end: string): string {
  if (range === "MAX") return "0000-00-00";
  if (range === "YTD") return `${end.slice(0, 4)}-01-01`;
  return minusDays(end, RANGE_DAYS[range]);
}

/**
 * Forward-fill `block`'s closes onto `axis`. For each axis date we carry
 * the most recent close at or before it; dates before the ticker's first
 * observation are null.
 */
function alignForwardFill(axis: string[], block: SlimBlock): (number | null)[] {
  const out: (number | null)[] = new Array(axis.length).fill(null);
  let j = 0;
  let last: number | null = null;
  for (let i = 0; i < axis.length; i++) {
    while (j < block.dates.length && block.dates[j] <= axis[i]) {
      last = block.close[j];
      j++;
    }
    out[i] = last;
  }
  return out;
}

function alignFx(
  axis: string[],
  series: { date: string; rate: number }[],
  fallback: number | undefined,
): number[] {
  const out: number[] = new Array(axis.length).fill(fallback ?? 1);
  if (series.length === 0) return out;
  let j = 0;
  let last = series[0].rate; // back-fill earliest rate for dates before history
  for (let i = 0; i < axis.length; i++) {
    while (j < series.length && series[j].date <= axis[i]) {
      last = series[j].rate;
      j++;
    }
    out[i] = last;
  }
  return out;
}

/** Down-sample parallel arrays to <= MAX_POINTS, always keeping the last. */
function strideIndices(n: number): number[] {
  if (n <= MAX_POINTS) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / MAX_POINTS);
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tickers = parseTickers(url.searchParams.get("tickers"));
  const rangeParam = url.searchParams.get("range");
  const range: RangeKey = isRange(rangeParam) ? rangeParam : "1Y";

  if (tickers.length === 0) {
    return Response.json(
      { ok: true, range, start: null, end: null, dates: [], series: {}, fx: {}, missing: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const [prices, fx] = await Promise.all([loadPrices(), loadFx()]);
  const cutoff = cutoffFor(range, prices.end);

  // Master axis: union of all requested tickers' dates within the window.
  const dateSet = new Set<string>();
  const missing: string[] = [];
  const blocks: Record<string, SlimBlock> = {};
  for (const t of tickers) {
    const block = prices.byTicker[t];
    if (!block) {
      missing.push(t);
      continue;
    }
    blocks[t] = block;
    for (const d of block.dates) {
      if (d >= cutoff) dateSet.add(d);
    }
  }

  let axis = Array.from(dateSet).sort();
  if (axis.length === 0) {
    return Response.json(
      { ok: true, range, start: null, end: null, dates: [], series: {}, fx: {}, missing },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Build aligned series at full resolution, then stride for transport.
  const fullSeries: Record<string, (number | null)[]> = {};
  for (const t of Object.keys(blocks)) {
    fullSeries[t] = alignForwardFill(axis, blocks[t]);
  }
  const fullFx: Record<string, number[]> = {};
  for (const [ccy, hist] of Object.entries(fx.history)) {
    fullFx[ccy] = alignFx(axis, hist, fx.rates[ccy]);
  }

  const keep = strideIndices(axis.length);
  if (keep.length !== axis.length) {
    axis = keep.map((i) => axis[i]);
    for (const t of Object.keys(fullSeries)) {
      fullSeries[t] = keep.map((i) => fullSeries[t][i]);
    }
    for (const ccy of Object.keys(fullFx)) {
      fullFx[ccy] = keep.map((i) => fullFx[ccy][i]);
    }
  }

  return Response.json(
    {
      ok: true,
      range,
      start: axis[0],
      end: axis[axis.length - 1],
      dates: axis,
      series: fullSeries,
      fx: fullFx,
      missing,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
