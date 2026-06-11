import { SectionLabel } from "./SectionLabel";

export function DashboardSkeleton() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg-primary">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <SectionLabel>Loading</SectionLabel>
          <p className="title mt-2">Portfolio Skyline</p>
        </div>
      </div>
    </div>
  );
}
