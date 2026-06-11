type Props = {
  className?: string;
  children: React.ReactNode;
  /** When true, the wrapper hugs its children without internal padding. */
  flush?: boolean;
};

export function Card({ className, children, flush }: Props) {
  return (
    <div
      className={
        "flex flex-col rounded-2xl " + (flush ? "" : "px-6 py-5 ") + (className ?? "")
      }
    >
      {children}
    </div>
  );
}
