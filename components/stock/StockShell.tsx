"use client";

import { useSearchParams } from "next/navigation";

import { isMetricKey } from "@/lib/metric-catalog";
import type { StockMetadata, StockSegments } from "@/lib/stock-data-loader";
import type { Fx } from "@/lib/types";

import { BusinessSegmentsSection } from "./BusinessSegmentsSection";
import { InsiderActivity } from "./InsiderActivity";
import { OverviewView } from "./OverviewView";
import { SingleMetricChart } from "./SingleMetricChart";
import { StockSidebar } from "./StockSidebar";

type Props = {
  ticker: string;
  metadata: StockMetadata;
  fx?: Fx | null;
  segments?: StockSegments | null;
};

export function StockShell({ ticker, metadata, fx, segments }: Props) {
  const params = useSearchParams();
  const raw = params.get("metric");

  let main: React.ReactNode;
  if (raw === "insider") {
    main = <InsiderActivity ticker={ticker} />;
  } else if (raw !== null && isMetricKey(raw)) {
    main = <SingleMetricChart ticker={ticker} metricKey={raw} metadata={metadata} />;
  } else {
    main = (
      <div className="flex flex-col gap-12">
        <OverviewView metadata={metadata} fx={fx} />
        {segments ? (
          <BusinessSegmentsSection segments={segments} currency={metadata.currency} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-8 py-10 md:flex-row md:gap-12">
      <StockSidebar ticker={ticker} />
      <main className="min-w-0 flex-1">{main}</main>
    </div>
  );
}
