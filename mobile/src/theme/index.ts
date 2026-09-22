/** One place for colour, type and spacing. The palette is deliberately high
 *  contrast: this app is used standing in a warehouse doorway in daylight.
 *
 *  Brightness comes from the grounds, tints and badges rather than from the
 *  fills - white text on a bright azure or coral button fails to read in
 *  sunlight, so anything carrying white text stays deep enough to pass 4.5:1.
 */
export const colors = {
  bg: "#F0F9FF",
  surface: "#FFFFFF",
  surfaceAlt: "#E4F1FB",
  border: "#D3E7F6",
  text: "#0A1C2B",
  textMuted: "#466276",
  textFaint: "#7C93A6",

  primary: "#0369A1",
  primaryDark: "#075985",
  primarySoft: "#D5ECFB",

  danger: "#E11D48",
  dangerSoft: "#FFE3EA",
  warning: "#B45309",
  warningSoft: "#FEEFD5",
  success: "#047857",
  successSoft: "#D7F5EB",
  // Violet rather than blue: "packed" has to be tellable from the primary
  // colour at a glance, and a blue badge on a blue-ish screen is not.
  info: "#6D28D9",
  infoSoft: "#EDE5FD",

  white: "#FFFFFF",
} as const;

/** React Native does not synthesize weights for a bundled font: `fontWeight`
 *  on a custom family is ignored on Android, so each weight is its own family
 *  and nothing in the app sets fontWeight. Loaded in src/app/_layout.tsx. */
export const typeface = {
  regular: "Manrope_500Medium",
  semibold: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  heavy: "Manrope_800ExtraBold",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  h1: 26,
  h2: 20,
  h3: 17,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

/** Android has no shadow prop worth using; elevation is what actually draws. */
export const shadow = {
  elevation: 2,
  shadowColor: "#0A1C2B",
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
} as const;

type Tone = "neutral" | "pending" | "packed" | "delivered" | "cancelled" | "unpaid" | "partial" | "paid";

export function toneColors(tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case "pending":
      return { bg: colors.warningSoft, fg: colors.warning };
    case "packed":
      return { bg: colors.infoSoft, fg: colors.info };
    case "delivered":
      return { bg: colors.successSoft, fg: colors.success };
    case "cancelled":
      return { bg: colors.surfaceAlt, fg: colors.textMuted };
    case "unpaid":
      return { bg: colors.dangerSoft, fg: colors.danger };
    case "partial":
      return { bg: colors.warningSoft, fg: colors.warning };
    case "paid":
      return { bg: colors.successSoft, fg: colors.success };
    default:
      return { bg: colors.surfaceAlt, fg: colors.textMuted };
  }
}
