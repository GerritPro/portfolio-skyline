import { colors } from "./design-tokens";

export const GRAY_RAMP = [
  "#1D1D1F",
  "#3A3A3C",
  "#6E6E73",
  "#86868B",
  "#AEAEB2",
] as const;

export function grayByRank(rank: number): string {
  const i = Math.max(0, Math.min(GRAY_RAMP.length - 1, rank));
  return GRAY_RAMP[i];
}

export function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff;
  const ag = (pa >> 8) & 0xff;
  const ab = pa & 0xff;
  const br = (pb >> 16) & 0xff;
  const bg = (pb >> 8) & 0xff;
  const bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (
    "#" + ((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0").toUpperCase()
  );
}

const HEATMAP_MIDPOINT = "#FBFBFD";

// Power-curve makes mid-range correlations (|r|≈0.3-0.5) visibly tinted
// instead of nearly white. Linear lerp left them too faint.
export function correlationColor(rho: number): string {
  const r = Math.max(-1, Math.min(1, rho));
  const t = Math.pow(Math.abs(r), 0.65);
  if (r >= 0) return lerpHex(HEATMAP_MIDPOINT, colors.accentBlue, t);
  return lerpHex(HEATMAP_MIDPOINT, colors.stateNegative, t);
}

// White text for high-saturation cells, primary text otherwise.
export function correlationTextColor(rho: number): string {
  return Math.abs(rho) > 0.6 ? "#FFFFFF" : "var(--text-primary)";
}

export const HEATMAP_DIAGONAL = "#F2F2F7";
