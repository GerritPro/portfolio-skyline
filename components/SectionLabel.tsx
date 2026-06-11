type Props = {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "div" | "p";
};

/**
 * Apple-Labs section label. Used to introduce a block of content.
 * 11px / weight 600 / tracking 0.08em / uppercase / text-secondary.
 */
export function SectionLabel({ children, className = "", as: As = "span" }: Props) {
  return (
    <As
      className={
        "text-[12px] font-semibold tracking-[0.08em] uppercase text-text-secondary " +
        className
      }
    >
      {children}
    </As>
  );
}
