/**
 * POST /api/refresh — triggers the Python pipeline (pull_daily + derived
 * + risk factors + ancillaries). Dev/local-use endpoint. Not safe for
 * untrusted public exposure; we only allow same-origin localhost.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";
// Refreshes touch the filesystem, so this must never be cached.
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — yfinance can be slow on slow days

// Simple in-process lock so concurrent button mashes don't fight over
// the same JSON files. The lock survives only inside a single Next.js
// dev/server process — that's the right scope for this tool.
let inFlight: Promise<RefreshResult> | null = null;

type RefreshResult = {
  status: "ok" | "error" | "busy" | "skipped";
  message: string;
  exitCode?: number;
  durationMs?: number;
  dataVersion?: string;
  /** Stdout / stderr tail for debugging — capped so we don't bloat the response. */
  log?: string;
};

function pythonExecutable(repoRoot: string): string | null {
  const candidates =
    process.platform === "win32"
      ? [".venv\\Scripts\\python.exe", ".venv\\Scripts\\python3.exe"]
      : [".venv/bin/python", ".venv/bin/python3"];
  for (const c of candidates) {
    const full = path.join(repoRoot, c);
    if (existsSync(full)) return full;
  }
  return null;
}

async function readDataVersion(repoRoot: string): Promise<string | undefined> {
  try {
    const raw = await readFile(
      path.join(repoRoot, "public", "data", "metadata.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    return typeof parsed.data_version === "string" ? parsed.data_version : undefined;
  } catch {
    return undefined;
  }
}

function isLocalRequest(request: NextRequest): boolean {
  // Dev tool — only accept requests whose Host header is localhost. We
  // intentionally don't reject on `x-forwarded-for` because dev
  // toolchains (Next.js itself, VS Code's browser preview, etc.) may
  // add it even for local connections.
  const host = request.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

function runOrchestrator(repoRoot: string, python: string): Promise<RefreshResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    // Force yfinance-only provider routing — the FMP path is currently
    // unavailable and each fallback adds ~8s per ticker, blowing the
    // timeout on a full-universe pull. The env var overrides anything
    // in .env.local because spawn-supplied env wins.
    const env = { ...process.env, DATA_PROVIDER: "yfinance" };
    const proc = spawn(python, ["-m", "pipeline.orchestrate"], {
      cwd: repoRoot,
      env,
      windowsHide: true,
    });

    const logBuffer: string[] = [];
    const pushLog = (chunk: Buffer) => {
      // Keep the last ~16KB of output. The orchestrator logs are chatty.
      logBuffer.push(chunk.toString("utf-8"));
      const joined = logBuffer.join("");
      if (joined.length > 16_000) {
        logBuffer.length = 0;
        logBuffer.push(joined.slice(-16_000));
      }
    };
    proc.stdout.on("data", pushLog);
    proc.stderr.on("data", pushLog);
    // Tee to server console so devs can watch in the Next.js dev log.
    proc.stdout.on("data", (c: Buffer) => process.stdout.write(c));
    proc.stderr.on("data", (c: Buffer) => process.stderr.write(c));

    const killTimer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5_000);
    }, TIMEOUT_MS);

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({
        status: "error",
        message: `Failed to spawn pipeline: ${err.message}`,
        log: logBuffer.join(""),
      });
    });

    proc.on("close", async (code) => {
      clearTimeout(killTimer);
      const durationMs = Date.now() - started;
      const dataVersion = await readDataVersion(repoRoot);
      if (code === 0) {
        resolve({
          status: "ok",
          message: "Pipeline complete",
          exitCode: 0,
          durationMs,
          dataVersion,
          log: logBuffer.join(""),
        });
      } else {
        resolve({
          status: "error",
          message: `Pipeline exited with code ${code}`,
          exitCode: code ?? -1,
          durationMs,
          dataVersion,
          log: logBuffer.join(""),
        });
      }
    });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isLocalRequest(request)) {
    return Response.json(
      { status: "error", message: "Refresh is only available from localhost." },
      { status: 403 },
    );
  }

  if (inFlight) {
    // Another refresh is already running — return its eventual result
    // rather than queueing a duplicate.
    const result = await inFlight;
    return Response.json({ ...result, status: result.status === "ok" ? "ok" : result.status });
  }

  const repoRoot = process.cwd();
  const python = pythonExecutable(repoRoot);
  if (!python) {
    return Response.json(
      {
        status: "error",
        message:
          "Could not find Python venv. Expected `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (Linux/Mac).",
      },
      { status: 500 },
    );
  }

  inFlight = runOrchestrator(repoRoot, python).finally(() => {
    inFlight = null;
  });
  const result = await inFlight;
  const httpStatus = result.status === "ok" ? 200 : 500;
  return Response.json(result, { status: httpStatus });
}

export async function GET(): Promise<Response> {
  // Lightweight status endpoint so the client can check if a refresh is
  // already running on page load.
  return Response.json({ status: inFlight ? "busy" : "idle" });
}
