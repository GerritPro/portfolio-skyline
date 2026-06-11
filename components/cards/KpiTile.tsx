import { SectionLabel } from "../SectionLabel";

type Props = {
  label: string;
  value: string;
  delta?: string | null;
  deltaTone?: "positive" | "negative" | "neutral";
  sub?: string | null;
};

const TONE: Record<NonNullable<Props["deltaTone"]>, string> = {
  positive: "text-state-positive",
  negative: "text-state-negative",
  neutral: "text-text-primary",
};

export function KpiTile({ label, value, delta, deltaTone = "neutral", sub }: Props) {
  return (
    <div className="surface-card flex flex-col px-6 py-5">
      <SectionLabel>{label}</SectionLabel>
      <span className={"display-md mt-3 " + TONE[deltaTone]}>{value}</span>
      {(delta || sub) && (
        <div className="mt-3 flex items-baseline gap-2">
          {delta ? (
            <span className={"text-[13px] font-medium tabular-nums " + TONE[deltaTone]}>{delta}</span>
          ) : null}
          {sub ? <span className="footnote tabular-nums">{sub}</span> : null}
        </div>
      )}
    </div>
  );
}
