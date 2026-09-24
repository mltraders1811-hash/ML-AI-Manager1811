import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, font, radius, spacing, typeface } from "../theme";

/** A headline number. Kept flat and wide so four of them fit on a small
 *  phone without turning into unreadable boxes. */
export function Stat({
  label,
  value,
  sub,
  icon,
  tone = colors.primary,
  onPress,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: string;
  onPress?: () => void;
}) {
  const body: ReactNode = (
    <>
      <View style={[s.iconWrap, { backgroundColor: `${tone}1A` }]}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </>
  );

  if (!onPress) return <View style={s.stat}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.stat, pressed && s.pressed]}
    >
      {body}
    </Pressable>
  );
}

const s = StyleSheet.create({
  stat: {
    flex: 1,
    minWidth: 150,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 2,
  },
  pressed: { opacity: 0.7 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: font.tiny,
    fontFamily: typeface.bold,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  value: { fontSize: font.h2, fontFamily: typeface.heavy, color: colors.text },
  sub: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted },
});
