/** One place for colour and spacing. The palette is deliberately high
 *  contrast: this app is used standing in a warehouse doorway in daylight. */
export const colors = {
  bg: "#F4F6F8",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF2F5",
  border: "#DCE3E8",
  text: "#10181F",
  textMuted: "#5B6B78",
  textFaint: "#8A99A6",

  primary: "#0F766E",
  primaryDark: "#0B5A54",
  primarySoft: "#E2F3F0",

  danger: "#C22F2F",
  dangerSoft: "#FBE9E9",
  warning: "#B45309",
  warningSoft: "#FDF2E2",
  success: "#15803D",
  successSoft: "#E6F4EA",
  info: "#1D4ED8",
  infoSoft: "#E8EEFD",

  white: "#FFFFFF",
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
  shadowColor: "#0B1B24",
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
