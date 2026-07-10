/**
 * Design tokens — mobile adaptation of widget/DESIGN.md (M72 SSOT).
 * Same dark + amber palette, touch-density spacing (~1.5x the widget's compact values,
 * with a 44px minimum row height for tappable rows).
 */

export const colors = {
  bg: "#0c0d10",
  bgRaised: "#14161b",
  border: "#23262d",

  text: "#e8eaed",
  textDim: "#9aa0a8",
  textFaint: "#5c6370",

  accent: "#f5a524",
  accentSoft: "rgba(245, 165, 36, 0.14)",

  danger: "#f0524f",
  ok: "#4cc38a",
} as const;

export const font = {
  family: "Pretendard",
  // fallback used only if Pretendard fails to load (see src/theme/useAppFonts.ts)
  fallback: undefined,
} as const;

export const type = {
  section: 12, // section label, uppercase, letter-spacing
  body: 15, // list row primary text
  meta: 12, // time / D-day / project label
  title: 20, // screen header
  lineHeight: 1.35,
} as const;

export const space = {
  itemGap: 9,
  sectionGap: 21,
  padX: 18,
  radius: 9,
  minRowHeight: 44,
} as const;

/** D-day color rule, ported 1:1 from widget/DESIGN.md. */
export function ddayColor(daysLeft: number): string {
  if (daysLeft <= 1) return colors.danger;
  if (daysLeft <= 3) return colors.accent;
  return colors.textDim;
}
