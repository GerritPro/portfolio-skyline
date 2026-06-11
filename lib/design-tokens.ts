/**
 * Apple-Labs design tokens, exposed as TypeScript constants.
 * Mirrors the CSS variables defined in app/globals.css; use this module
 * where a chart or runtime computation needs the raw hex (e.g. Recharts
 * `stroke="..."` props, RGBA derivations).
 */

export const colors = {
  bgPrimary: "#FBFBFD",
  bgSecondary: "#FFFFFF",
  textPrimary: "#1D1D1F",
  textSecondary: "#6E6E73",
  textTertiary: "#86868B",
  divider: "#D2D2D7",
  accentBlue: "#0071E3",
  accentBlueHover: "#0077ED",
  statePositive: "#30A46C",
  stateNegative: "#E5484D",
  chartNeutral: "#86868B",
} as const;

export const softs = {
  accentBlue: "rgba(0, 113, 227, 0.10)",
  statePositive: "rgba(48, 164, 108, 0.12)",
  stateNegative: "rgba(229, 72, 77, 0.10)",
  hairlineSoft: "rgba(0, 0, 0, 0.08)",
  hairlineFaint: "rgba(0, 0, 0, 0.04)",
} as const;

export const typography = {
  displayXl: { fontSize: 96, fontWeight: 200, letterSpacing: "-0.02em", lineHeight: 1.04 },
  displayLg: { fontSize: 64, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.06 },
  displayMd: { fontSize: 40, fontWeight: 300, letterSpacing: "-0.01em", lineHeight: 1.10 },
  title:     { fontSize: 24, fontWeight: 500, letterSpacing: "-0.005em", lineHeight: 1.25 },
  body:      { fontSize: 17, fontWeight: 400, lineHeight: 1.5 },
  caption:   { fontSize: 14, fontWeight: 400, lineHeight: 1.4 },
  label:     { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const },
} as const;

export type ColorToken = keyof typeof colors;
export type SoftToken = keyof typeof softs;
export type TypographyToken = keyof typeof typography;

/**
 * Decompose a #RRGGBB hex into rgba() with a specified alpha.
 * Returns a CSS string. Falls back to neutral grey on parse failure.
 */
export function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return `rgba(134, 134, 139, ${alpha})`;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}
