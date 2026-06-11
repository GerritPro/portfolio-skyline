"use client";

/**
 * Innovation lens — patent filings as a forward-looking signal of where
 * each holding is investing R&D.
 *
 * Three data sources, loaded lazy:
 *   /data/patents.json             — raw bulk stats per ticker
 *   /data/patents/summaries.json   — Claude Haiku plain-English summaries
 *   /data/patents/images/{id}.jpg  — first-figure screenshots, lazy 404 → placeholder
 *
 * Modes:
 *   • patents.json absent           → polished "Pipeline ready" teaser
 *   • patents.json present, no LLM  → counts + sparklines + titles, no narrative
 *   • everything present            → full magazine layout per ticker
 */

import { useEffect, useMemo, useState } from "react";

import Image from "next/image";
import { motion } from "motion/react";

import { colors } from "@/lib/design-tokens";
import { formatPct, toneFor } from "@/lib/format";
import { useHoldingsStore } from "@/lib/holdings";
import { EASE_OUT_STRONG } from "@/lib/motion";

type Quarterly = { quarter: string; filings: number };
type LatestPatent = {
  id: string;
  title: string;
  date: string;
  abstract?: string;
};
type TickerPatents = {
  company: string | null;
  total_filings_window: number;
  last_4q: number;
  prev_4q: number;
  yoy_change: number | null;
  quarterly: Quarterly[];
  latest_patents: LatestPatent[];
};
type PatentsPayload = {
  version: number;
  generated_at: string;
  as_of: string;
  window_years: number;
  tickers: Record<string, TickerPatents>;
};
type SummariesPayload = {
  patents: Record<string, { summary: string; title?: string }>;
  tickers: Record<string, { narrative: string }>;
};

const MAX_FEATURED_TICKERS = 6;
const FEATURED_PATENTS_PER_TICKER = 4;

export function InnovationLens() {
  const [patents, setPatents] = useState<PatentsPayload | null>(null);
  const [summaries, setSummaries] = useState<SummariesPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const holdings = useHoldingsStore((s) => s.holdings);
  const hasHydrated = useHoldingsStore((s) => s.hasHydrated);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/data/patents.json", { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<PatentsPayload>) : null,
      ),
      fetch("/data/patents/summaries.json", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<SummariesPayload>) : null))
        .catch(() => null),
    ])
      .then(([p, s]) => {
        if (cancelled) return;
        if (!p) {
          setState("missing");
          return;
        }
        setPatents(p);
        setSummaries(s);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-8">
        <div className="h-[480px] animate-pulse rounded-2xl bg-bg-soft" aria-hidden />
      </div>
    );
  }

  if (state === "missing" || !patents) {
    return <PipelineReadyTeaser />;
  }

  return (
    <LoadedView
      patents={patents}
      summaries={summaries}
      holdings={holdings}
      hasHydrated={hasHydrated}
    />
  );
}

// -------------- loaded view (magazine) --------------

function LoadedView({
  patents,
  summaries,
  holdings,
  hasHydrated,
}: {
  patents: PatentsPayload;
  summaries: SummariesPayload | null;
  holdings: { ticker: string; shares: number }[];
  hasHydrated: boolean;
}) {
  const featured = useMemo(() => {
    const all = Object.entries(patents.tickers);
    if (hasHydrated && holdings.length > 0) {
      const heldSet = new Set(holdings.map((h) => h.ticker));
      const held = all.filter(([t]) => heldSet.has(t));
      held.sort((a, b) => b[1].last_4q - a[1].last_4q);
      if (held.length >= 3) return held.slice(0, MAX_FEATURED_TICKERS);
      const others = all
        .filter(([t]) => !heldSet.has(t))
        .sort((a, b) => b[1].last_4q - a[1].last_4q)
        .slice(0, MAX_FEATURED_TICKERS - held.length);
      return [...held, ...others];
    }
    return all
      .sort((a, b) => b[1].last_4q - a[1].last_4q)
      .slice(0, MAX_FEATURED_TICKERS);
  }, [patents.tickers, holdings, hasHydrated]);

  const totals = useMemo(() => {
    const rows = Object.values(patents.tickers);
    const sumLast4 = rows.reduce((s, x) => s + (x.last_4q || 0), 0);
    const sumPrev4 = rows.reduce((s, x) => s + (x.prev_4q || 0), 0);
    const yoy = sumPrev4 > 0 ? sumLast4 / sumPrev4 - 1 : null;
    const withPatents = rows.filter((x) => x.total_filings_window > 0).length;
    return { sumLast4, yoy, withPatents, totalTickers: rows.length };
  }, [patents.tickers]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
        className="flex flex-wrap items-baseline justify-between gap-4"
      >
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.10em] text-text-tertiary">
            Innovation
          </span>
          <h2 className="mt-2 text-[28px] font-light tracking-tight text-text-primary">
            Patent pipeline
          </h2>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-text-secondary">
            What each holding is actually building. Granted-patent filings from
            the last {patents.window_years} years, with USPTO abstracts
            translated into plain English.
          </p>
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-[0.10em] text-text-tertiary">
            As of
          </span>
          <div className="font-mono text-[12px] text-text-secondary">{patents.as_of}</div>
        </div>
      </motion.div>

      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-[color:var(--hairline-faint)] pt-6 sm:grid-cols-4">
        <Metric label="Total filings · 4Q" value={totals.sumLast4.toLocaleString()} />
        <Metric
          label="YoY change"
          value={totals.yoy === null ? "—" : formatPct(totals.yoy, { sign: true, digits: 1 })}
          tone={toneFor(totals.yoy)}
        />
        <Metric
          label="Coverage"
          value={`${totals.withPatents} / ${totals.totalTickers}`}
          hint="tickers with grants"
        />
        <Metric label="Window" value={`${patents.window_years}y`} hint="rolling lookback" />
      </div>

      <div className="mt-14 flex flex-col gap-16">
        {featured.map(([ticker, data], idx) => (
          <TickerSection
            key={ticker}
            ticker={ticker}
            data={data}
            narrative={summaries?.tickers?.[ticker]?.narrative ?? null}
            patentSummaries={summaries?.patents ?? {}}
            delay={0.06 * idx}
          />
        ))}
      </div>

      {!summaries || Object.keys(summaries.patents).length === 0 ? (
        <SummariesMissingCallout />
      ) : (
        <NextStepsCallout />
      )}
    </div>
  );
}

function TickerSection({
  ticker,
  data,
  narrative,
  patentSummaries,
  delay,
}: {
  ticker: string;
  data: TickerPatents;
  narrative: string | null;
  patentSummaries: Record<string, { summary: string }>;
  delay: number;
}) {
  const yoy = data.yoy_change;
  const yoyTone = toneFor(yoy);
  const yoyText = yoy === null ? "n/a" : formatPct(yoy, { sign: true, digits: 0 });
  const featured = data.latest_patents.slice(0, FEATURED_PATENTS_PER_TICKER);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.5, delay, ease: EASE_OUT_STRONG }}
      className="flex flex-col gap-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[color:var(--hairline-faint)] pb-4">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[20px] font-semibold tracking-tight text-text-primary">
            {ticker}
          </span>
          {data.company ? (
            <span className="text-[13px] text-text-secondary">
              {truncate(data.company, 50)}
            </span>
          ) : null}
        </div>
        <div className="flex items-baseline gap-5">
          <span className="text-[24px] font-light leading-none tabular-nums text-text-primary">
            {data.last_4q.toLocaleString()}
          </span>
          <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
            filings · last 4Q
          </span>
          <span
            className={
              "text-[12px] font-medium tabular-nums " +
              (yoyTone === "positive"
                ? "text-state-positive"
                : yoyTone === "negative"
                  ? "text-state-negative"
                  : "text-text-tertiary")
            }
          >
            YoY {yoyText}
          </span>
        </div>
      </div>

      <QuarterlyChart series={data.quarterly} />

      {narrative ? (
        <p className="max-w-3xl text-[15px] leading-[1.6] text-text-primary">
          {narrative}
        </p>
      ) : (
        <p className="max-w-2xl text-[13px] italic leading-relaxed text-text-tertiary">
          Narrative summary pending — run{" "}
          <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[11px]">
            python -m pipeline.summarize_patents
          </code>{" "}
          to generate.
        </p>
      )}

      {featured.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2">
          {featured.map((p) => (
            <PatentCard
              key={p.id}
              patent={p}
              summary={patentSummaries[p.id]?.summary ?? null}
            />
          ))}
        </div>
      ) : null}
    </motion.section>
  );
}

function PatentCard({
  patent,
  summary,
}: {
  patent: LatestPatent;
  summary: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const imgSrc = `/data/patents/images/${patent.id}.jpg`;

  return (
    <article className="flex gap-4 overflow-hidden rounded-2xl border border-[color:var(--hairline-soft)] bg-bg-secondary p-4 transition-colors duration-200">
      <div className="relative h-[120px] w-[120px] flex-shrink-0 overflow-hidden rounded-xl bg-[color:var(--bg-card-soft)]">
        {imgFailed ? (
          <PatentImagePlaceholder />
        ) : (
          <Image
            src={imgSrc}
            alt={`Figure from patent ${patent.id}`}
            fill
            sizes="120px"
            className="object-contain"
            onError={() => setImgFailed(true)}
            unoptimized
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[13px] font-semibold leading-snug text-text-primary">
            {truncate(patent.title, 90)}
          </h4>
        </div>
        {summary ? (
          <p className="text-[13px] leading-[1.5] text-text-secondary">
            {summary}
          </p>
        ) : patent.abstract ? (
          <p className="text-[12px] italic leading-relaxed text-text-tertiary">
            {truncate(patent.abstract, 180)}
          </p>
        ) : null}
        <div className="mt-auto flex items-baseline justify-between gap-3 pt-1 text-[11px] tabular-nums text-text-tertiary">
          <span className="font-mono">{patent.id}</span>
          <span>{patent.date}</span>
        </div>
      </div>
    </article>
  );
}

function PatentImagePlaceholder() {
  return (
    <svg
      viewBox="0 0 80 80"
      className="absolute inset-0 m-auto h-1/2 w-1/2 text-text-tertiary"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <rect x="10" y="14" width="60" height="52" rx="3" />
      <path d="M18 50l12-14 10 10 8-6 14 14" />
      <circle cx="28" cy="26" r="3" />
    </svg>
  );
}

function QuarterlyChart({ series }: { series: Quarterly[] }) {
  const tail = series.slice(-8);
  if (tail.length === 0) {
    return <div className="h-[48px]" aria-hidden />;
  }
  const max = Math.max(1, ...tail.map((q) => q.filings));
  return (
    <div className="flex h-[48px] items-end gap-1.5">
      {tail.map((q) => {
        const h = Math.max(3, (q.filings / max) * 48);
        return (
          <div
            key={q.quarter}
            title={`${q.quarter}: ${q.filings}`}
            className="flex-1 rounded-sm transition-opacity hover:opacity-90"
            style={{
              height: h,
              backgroundColor: colors.accentBlue,
              opacity: 0.55,
            }}
          />
        );
      })}
    </div>
  );
}

// -------------- small bits --------------

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const color =
    tone === "positive"
      ? "text-state-positive"
      : tone === "negative"
        ? "text-state-negative"
        : "text-text-primary";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </span>
      <span className={"text-[22px] font-light tracking-tight tabular-nums " + color}>
        {value}
      </span>
      {hint ? (
        <span className="text-[11px] text-text-tertiary">{hint}</span>
      ) : null}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

function NextStepsCallout() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
      className="mt-16 rounded-2xl border border-[color:var(--hairline-soft)] bg-[color:var(--bg-card-soft)] px-6 py-5"
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.10em] text-text-secondary">
        Coming next
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">
        IPC-code → human-category clustering (so we can chart{" "}
        <em>which themes</em> each company is concentrating in over time),
        plus quarter-over-quarter direction-shift alerts in the hero strip.
      </p>
    </motion.div>
  );
}

function SummariesMissingCallout() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
      className="mt-16 rounded-2xl border border-[color:var(--hairline-soft)] bg-[color:var(--bg-card-soft)] px-6 py-5"
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.10em] text-text-secondary">
        Want plain-English summaries for every patent?
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">
        Install{" "}
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className="text-accent-blue hover:underline"
        >
          Ollama
        </a>{" "}
        (free, runs locally), pull a model with{" "}
        <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[12px]">
          ollama pull qwen2.5:7b
        </code>
        , then run{" "}
        <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[12px]">
          python -m pipeline.summarize_patents
        </code>
        . No API key, no quota, fully offline. ~10 min on a modern laptop;
        subsequent runs only summarise new grants.
      </p>
    </motion.div>
  );
}

// -------------- "pipeline ready" teaser (no patents.json yet) --------------

function PipelineReadyTeaser() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_STRONG }}
        className="flex flex-wrap items-baseline justify-between gap-4"
      >
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-blue-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.10em] text-accent-blue">
            Pipeline ready
          </span>
          <h2 className="mt-3 text-[28px] font-light tracking-tight text-text-primary">
            Innovation pipeline
          </h2>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-text-secondary">
            Patent filings as a forward-looking signal of where each holding is
            actually investing R&amp;D — bulk-downloaded, image-pulled, and
            translated into plain English by an LLM.
          </p>
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-[0.10em] text-text-tertiary">
            Source
          </span>
          <span className="block rounded-md bg-bg-soft px-2 py-0.5 font-mono text-[12px] text-text-secondary">
            PatentsView · Google Patents · Ollama
          </span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: EASE_OUT_STRONG }}
        className="mt-8 rounded-2xl border border-[color:var(--hairline-soft)] bg-bg-secondary px-6 py-5"
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.10em] text-text-secondary">
          Setup — fully local, no API keys
        </h3>
        <ol className="mt-3 flex flex-col gap-3 text-[13.5px] leading-relaxed text-text-secondary">
          <li className="flex gap-3">
            <Step n={1} />
            <div>
              <span>
                Install Ollama (one-time) from{" "}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-blue hover:underline"
                >
                  ollama.com/download
                </a>
                , then pull a model (~5 GB):
              </span>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft px-3 py-2 font-mono text-[12px] text-text-primary">
                {`ollama pull qwen2.5:7b`}
              </pre>
              <span className="text-[12px] text-text-tertiary">
                Other models work too — set{" "}
                <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[11px]">
                  OLLAMA_MODEL=llama3.1:8b
                </code>{" "}
                in .env.local to switch.
              </span>
            </div>
          </li>
          <li className="flex gap-3">
            <Step n={2} />
            <div>
              <span>First run — bulk download + DuckDB ingest + images + local LLM. ~15 min one-time on a modern laptop.</span>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft px-3 py-2 font-mono text-[12px] text-text-primary">
                {`python -m pipeline.pull_patents`}
              </pre>
            </div>
          </li>
          <li className="flex gap-3">
            <Step n={3} />
            <div>
              <span>Schedule weekly via Windows Task Scheduler:</span>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-soft px-3 py-2 font-mono text-[12px] text-text-primary">
                {`Register-ScheduledTask \`\n  -Xml (Get-Content pipeline\\scheduled_tasks\\patents_weekly.xml -Raw) \`\n  -TaskName "PortfolioSkyline-PatentsWeekly"`}
              </pre>
              <span className="text-[12px] text-text-tertiary">
                Sunday 03:00, only on AC + online. Ollama runs as a background service so the cron task just calls it.
              </span>
            </div>
          </li>
        </ol>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: EASE_OUT_STRONG }}
        className="mt-8 rounded-2xl border border-[color:var(--hairline-soft)] bg-[color:var(--bg-card-soft)] px-6 py-5"
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.10em] text-text-secondary">
          What ships
        </h3>
        <ul className="mt-3 grid gap-3 text-[13.5px] leading-relaxed text-text-secondary md:grid-cols-2">
          <li className="flex gap-3">
            <Dot />
            <span>
              <strong className="text-text-primary">Per-holding filing velocity</strong>{" "}
              — last 4Q + YoY arrow + 8-quarter sparkline.
            </span>
          </li>
          <li className="flex gap-3">
            <Dot />
            <span>
              <strong className="text-text-primary">Representative figure</strong>{" "}
              for each featured patent, pulled from Google Patents.
            </span>
          </li>
          <li className="flex gap-3">
            <Dot />
            <span>
              <strong className="text-text-primary">Plain-English summary</strong>{" "}
              per patent — 2 sentences a non-engineer can read at a glance.
            </span>
          </li>
          <li className="flex gap-3">
            <Dot />
            <span>
              <strong className="text-text-primary">"What they're working on"</strong>{" "}
              paragraph per ticker — LLM-rolled-up themes.
            </span>
          </li>
        </ul>
      </motion.div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mt-[1px] inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--accent-blue-soft)] font-mono text-[11px] font-semibold text-accent-blue">
      {n}
    </span>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="mt-[7px] inline-flex h-[5px] w-[5px] flex-shrink-0 rounded-full bg-accent-blue"
    />
  );
}
