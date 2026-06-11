"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

type RefreshResponse = {
  status: string;
  message?: string;
  durationMs?: number;
  dataVersion?: string;
};

export function RefreshButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  // If the server already has a refresh in flight when this component
  // mounts (e.g. user reloaded mid-run), reattach to it so the UI
  // reflects reality.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/refresh", { method: "GET" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || j?.status !== "busy") return;
        setRunning(true);
        runToast({ alreadyRunning: true });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runToast = ({ alreadyRunning }: { alreadyRunning: boolean }) => {
    const startedAt = Date.now();
    const promise = fetch("/api/refresh", { method: "POST" })
      .then(async (res) => {
        const json = (await res.json()) as RefreshResponse;
        if (!res.ok || json.status !== "ok") {
          throw new Error(json.message ?? `Refresh failed (HTTP ${res.status})`);
        }
        return json;
      })
      .finally(() => setRunning(false));

    toast.promise(promise, {
      loading: alreadyRunning
        ? "Refresh already running — attaching to current run…"
        : "Refreshing market data…",
      description: "Pulling prices, derivatives, FX, and insider activity.",
      success: (data) => {
        const dur = data.durationMs ?? Date.now() - startedAt;
        router.refresh();
        return {
          message: `Updated · ${formatDuration(dur)}`,
          description: data.dataVersion
            ? `Data version ${data.dataVersion}`
            : undefined,
        };
      },
      error: (err: unknown) => ({
        message: "Refresh failed",
        description: err instanceof Error ? err.message : String(err),
      }),
    });

    setRunning(true);
  };

  const onClick = () => {
    if (running) return;
    runToast({ alreadyRunning: false });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      aria-label={running ? "Refreshing data" : "Refresh price data"}
      title={
        running
          ? "Refreshing… can take 20+ minutes for a full pull"
          : "Refresh price data"
      }
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-[colors,transform] duration-150 ease-out hover:bg-bg-soft hover:text-text-primary active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        transitionTimingFunction: "var(--ease-out-strong, cubic-bezier(0.23, 1, 0.32, 1))",
      }}
    >
      <Icon spinning={running} />
    </button>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(secs < 10 ? 1 : 0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs - m * 60);
  return `${m}m ${s}s`;
}

function Icon({ spinning }: { spinning: boolean }) {
  if (spinning) {
    return (
      <svg
        className="animate-spin"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden
      >
        <circle
          cx="7"
          cy="7"
          r="5.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeOpacity="0.25"
          fill="none"
        />
        <path
          d="M12.4 7a5.4 5.4 0 0 0-5.4-5.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M2.3 7A4.7 4.7 0 0 1 11 4.4 M11.7 7A4.7 4.7 0 0 1 3 9.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M11.2 1.6L11.2 4.4L8.4 4.4 M2.8 12.4L2.8 9.6L5.6 9.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
