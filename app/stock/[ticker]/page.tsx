import { notFound } from "next/navigation";
import { Suspense } from "react";

import { StockPageHeader } from "@/components/stock/StockPageHeader";
import { StockShell } from "@/components/stock/StockShell";
import { loadFx, loadStockMetadata, loadStockSegments } from "@/lib/stock-data-loader";

type Props = {
  params: Promise<{ ticker: string }>;
};

export default async function StockPage({ params }: Props) {
  const { ticker } = await params;
  const upper = ticker.toUpperCase();
  const [metadata, fx, segments] = await Promise.all([
    loadStockMetadata(upper),
    loadFx(),
    loadStockSegments(upper),
  ]);
  if (!metadata) notFound();

  return (
    <div className="flex min-h-screen w-screen flex-col bg-bg">
      <StockPageHeader metadata={metadata} />
      <Suspense fallback={<StockShellSkeleton />}>
        <StockShell ticker={upper} metadata={metadata} fx={fx} segments={segments} />
      </Suspense>
    </div>
  );
}

function StockShellSkeleton() {
  return (
    <div className="flex flex-col gap-8 px-8 py-10 md:flex-row md:gap-12">
      <div className="hidden w-[260px] shrink-0 md:block" />
      <div className="min-w-0 flex-1">
        <div className="h-[48px] w-32 animate-pulse rounded bg-bg-soft" />
        <div className="mt-6 h-[400px] w-full animate-pulse rounded bg-bg-soft" />
      </div>
    </div>
  );
}
