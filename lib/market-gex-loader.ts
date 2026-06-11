import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { MarketGexSchema, type MarketGex } from "./types";

const GEX_FILE = path.join(process.cwd(), "public", "data", "market", "gex.json");

export async function loadMarketGex(): Promise<MarketGex | null> {
  let raw: string;
  try {
    raw = await readFile(GEX_FILE, "utf-8");
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = MarketGexSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
