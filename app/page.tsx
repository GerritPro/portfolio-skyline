import { Suspense } from "react";

import { DashboardServer } from "@/components/DashboardServer";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";

export default function Page() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardServer />
    </Suspense>
  );
}
