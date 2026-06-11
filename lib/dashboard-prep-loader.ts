import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  FxSchema,
  MetadataSchema,
  PipelineMissingError,
  SectorsSchema,
  type Fx,
  type Metadata,
  type Profile,
  type Sectors,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

export type DashboardByTicker = {
  currentPe: number | null;
  ownMean: number;
  ownStd: number;
  zScore: number;
  return1d: number | null;
  return1m: number | null;
  return1y: number | null;
  return5y: number | null;
};

export type DashboardPrep = {
  universeTickers: Profile[];
  byTicker: Record<string, DashboardByTicker>;
  lastClose: Record<string, number>;
  tickersBySector: Record<string, string[]>;
};

async function readAndParse<T>(filename: string): Promise<T> {
  const fullPath = path.join(DATA_DIR, filename);
  let raw: string;
  try {
    raw = await readFile(fullPath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PipelineMissingError(filename);
    }
    throw err;
  }
  return JSON.parse(raw) as T;
}

async function tryReadFx(): Promise<Fx | null> {
  try {
    const raw = await readFile(path.join(DATA_DIR, "fx.json"), "utf-8");
    const parsed = FxSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Fast Dashboard data path — reads only precomputed slim files. The 50MB
 *  prices.json + 7MB fundamentals.json don't touch this code path. In dev
 *  we skip Zod validation entirely (~3s saved on cold start for the 2MB
 *  correlations matrix); prod re-enables it. */
export async function loadDashboardPrep(): Promise<{
  prep: DashboardPrep;
  sectors: Sectors;
  metadata: Metadata;
  fx: Fx | null;
}> {
  // Note: correlations.json (2MB, 500x500 matrix) is NOT loaded here. The
  // CorrelationHeatmapCard fetches it lazily client-side so the dashboard
  // SSR payload stays under ~300KB.
  const [prep, sectorsRaw, metadataRaw, fx] = await Promise.all([
    readAndParse<DashboardPrep>("dashboard_prep.json"),
    readAndParse<unknown>("sectors.json"),
    readAndParse<unknown>("metadata.json"),
    tryReadFx(),
  ]);

  const skipValidation = process.env.NODE_ENV !== "production";
  return {
    prep,
    sectors: skipValidation
      ? (sectorsRaw as Sectors)
      : SectorsSchema.parse(sectorsRaw),
    metadata: skipValidation
      ? (metadataRaw as Metadata)
      : MetadataSchema.parse(metadataRaw),
    fx,
  };
}
