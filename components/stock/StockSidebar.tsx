"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CATEGORIES, METRICS } from "@/lib/metric-catalog";

type Props = {
  ticker: string;
};

export function StockSidebar({ ticker }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get("metric") ?? "overview";

  const onSelect = (key: string) => {
    const next = new URLSearchParams(params.toString());
    if (key === "overview") next.delete("metric");
    else next.set("metric", key);
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        aria-label="Metric navigation"
        className="hidden w-[260px] shrink-0 self-start md:sticky md:top-6 md:block"
      >
        <SidebarItem
          label="Overview"
          selected={active === "overview"}
          onSelect={() => onSelect("overview")}
          standalone
        />
        {CATEGORIES.map((cat) => (
          <div key={cat.key} className="mt-8">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
              {cat.label}
            </div>
            <ul className="flex flex-col gap-0.5">
              {cat.metrics.map((mKey) => {
                const meta = METRICS[mKey];
                return (
                  <li key={mKey}>
                    <SidebarItem
                      label={meta.label}
                      selected={active === mKey}
                      onSelect={() => onSelect(mKey)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Mobile horizontal tab-bar */}
      <nav
        aria-label="Metric navigation"
        className="md:hidden -mx-8 mb-6 overflow-x-auto border-b border-[color:var(--hairline-soft)]"
      >
        <ul className="flex gap-1 px-8 py-3 whitespace-nowrap">
          <li>
            <TabItem
              label="Overview"
              selected={active === "overview"}
              onSelect={() => onSelect("overview")}
            />
          </li>
          {CATEGORIES.flatMap((cat) =>
            cat.metrics.map((mKey) => (
              <li key={mKey}>
                <TabItem
                  label={METRICS[mKey].label}
                  selected={active === mKey}
                  onSelect={() => onSelect(mKey)}
                />
              </li>
            )),
          )}
        </ul>
      </nav>

      <span data-stock-context={ticker} className="hidden" aria-hidden />
    </>
  );
}

function SidebarItem({
  label,
  selected,
  onSelect,
  standalone,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  standalone?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "block w-full rounded text-left text-[15px] transition-colors duration-150 ease-out " +
        (standalone ? "" : "") +
        " " +
        (selected
          ? "text-accent-blue"
          : "text-text-secondary hover:text-text-primary")
      }
    >
      <span className="block py-1.5">{label}</span>
    </button>
  );
}

function TabItem({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 ease-out " +
        (selected
          ? "bg-bg-soft text-text-primary"
          : "text-text-secondary hover:text-text-primary")
      }
    >
      {label}
    </button>
  );
}
