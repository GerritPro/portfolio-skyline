/**
 * The set of lenses the dashboard switches between. One source of truth
 * for IDs, labels, captions, and ordering. Lens components and the
 * picker both consume from here so adding/removing a lens is a single
 * edit rather than a hunt-and-update across files.
 *
 * Composition is NOT a lens — it's the permanent foundation that gives
 * every other lens meaning. Lenses are *analyses* of the portfolio,
 * not parts of it.
 */

export type LensId =
  | "performance"
  | "risk"
  | "valuation"
  | "movement"
  | "network"
  | "market"
  | "innovation";

export type LensMeta = {
  id: LensId;
  label: string;
  caption: string;
  /** Tag shown when the lens is brand-new / not yet fully shipped. */
  badge?: "new" | "soon";
};

export const LENSES: readonly LensMeta[] = [
  { id: "performance", label: "Performance", caption: "growth & drawdown", badge: "new" },
  { id: "risk",        label: "Risk",        caption: "what drives it" },
  { id: "valuation",   label: "Valuation",   caption: "cheap or rich" },
  { id: "movement",    label: "Movement",    caption: "today's flow" },
  { id: "network",     label: "Network",     caption: "how they connect" },
  { id: "market",      label: "Market",      caption: "gamma & context" },
  { id: "innovation",  label: "Innovation",  caption: "patent pipeline", badge: "soon" },
] as const;

export const DEFAULT_LENS: LensId = "performance";

export function lensIndex(id: LensId): number {
  return LENSES.findIndex((l) => l.id === id);
}

export function isLensId(value: unknown): value is LensId {
  if (typeof value !== "string") return false;
  return LENSES.some((l) => l.id === value);
}
