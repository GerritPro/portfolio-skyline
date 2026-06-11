import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  CorrelationsSchema,
  FundamentalsSchema,
  FxSchema,
  MetadataSchema,
  PipelineMissingError,
  PipelineValidationError,
  PricesSchema,
  SectorsSchema,
  UniverseSchema,
  type Fx,
  type PipelineData,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

type FileSpec<S extends z.ZodTypeAny> = {
  key: string;
  filename: string;
  schema: S;
};

function spec<S extends z.ZodTypeAny>(key: string, filename: string, schema: S): FileSpec<S> {
  return { key, filename, schema };
}

const FILES = [
  spec("universe", "universe.json", UniverseSchema),
  spec("prices", "prices.json", PricesSchema),
  spec("fundamentals", "fundamentals.json", FundamentalsSchema),
  spec("correlations", "correlations.json", CorrelationsSchema),
  spec("sectors", "sectors.json", SectorsSchema),
  spec("metadata", "metadata.json", MetadataSchema),
] as const;

async function loadOne<S extends z.ZodTypeAny>(
  fileSpec: FileSpec<S>,
): Promise<z.infer<S>> {
  const fullPath = path.join(DATA_DIR, fileSpec.filename);

  let raw: string;
  try {
    raw = await readFile(fullPath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PipelineMissingError(fileSpec.filename);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PipelineValidationError(fileSpec.filename, [
      { path: "(root)", message: "file is not valid JSON" },
    ]);
  }

  const result = fileSpec.schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? "(root)" : issue.path.join("."),
      message: issue.message,
    }));
    throw new PipelineValidationError(fileSpec.filename, issues);
  }

  return result.data;
}

async function loadFxOptional(): Promise<Fx | null> {
  const fullPath = path.join(DATA_DIR, "fx.json");
  let raw: string;
  try {
    raw = await readFile(fullPath, "utf-8");
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
  try {
    const parsed = JSON.parse(raw);
    const result = FxSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function loadPipelineData(): Promise<PipelineData> {
  const [universe, prices, fundamentals, correlations, sectors, metadata, fx] =
    await Promise.all([
      loadOne(FILES[0]),
      loadOne(FILES[1]),
      loadOne(FILES[2]),
      loadOne(FILES[3]),
      loadOne(FILES[4]),
      loadOne(FILES[5]),
      loadFxOptional(),
    ]);

  return { universe, prices, fundamentals, correlations, sectors, metadata, fx };
}
