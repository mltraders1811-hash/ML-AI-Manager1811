import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";

import { colors, font, radius, shadow, spacing, toneColors, typeface } from "../theme";

/* ------------------------------------------------------------------- text */

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={s.subtitle}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

/* ------------------------------------------------------------------ cards */

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        // A flat card gives no feedback on tap; dimming it is the cheapest
        // signal that the row did something.
        style={({ pressed }) => [s.card, style, pressed && s.pressed]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={s.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- buttons */

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const palette = buttonPalette(variant);
  const isOff = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && !isOff && s.pressed,
        isOff && s.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
          <Text style={[s.buttonText, { color: palette.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

function buttonPalette(variant: "primary" | "secondary" | "danger" | "ghost") {
  switch (variant) {
    case "secondary":
      return { bg: colors.surface, fg: colors.primary, border: colors.border };
    case "danger":
      return { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft };
    case "ghost":
      return { bg: "transparent", fg: colors.textMuted, border: "transparent" };
    default:
      return { bg: colors.primary, fg: colors.white, border: colors.primary };
  }
}

export function IconButton({
  icon,
  onPress,
  color = colors.textMuted,
  size = 22,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  color?: string;
  size?: number;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={s.iconButton}>
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

/* ----------------------------------------------------------------- inputs */

export function Field({
  label,
  hint,
  style,
  ...props
}: TextInputProps & { label?: string; hint?: string; style?: ViewStyle }) {
  return (
    <View style={[s.field, style]}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...props}
        style={[s.input, props.multiline && s.inputMultiline]}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/** A field that opens something (a party list, a date picker) instead of
 *  taking keystrokes. */
export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  onClear,
}: {
  label?: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
  onClear?: () => void;
}) {
  return (
    <View style={s.field}>
      {label ? <Label>{label}</Label> : null}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [s.input, s.select, pressed && s.pressed]}
      >
        <Text style={value ? s.selectValue : s.selectPlaceholder} numberOfLines={1}>
          {value || placeholder}
        </Text>
        {value && onClear ? (
          <IconButton icon="close-circle" onPress={onClear} size={18} />
        ) : (
          <Ionicons name="chevron-down" size={18} color={colors.textFaint} />
        )}
      </Pressable>
    </View>
  );
}

export function SearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  return (
    <View style={s.searchBar}>
      <Ionicons name="search" size={18} color={colors.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={s.searchInput}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <IconButton icon="close-circle" onPress={() => onChangeText("")} size={18} />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ chips */

export function Chip({
  label,
  selected,
  onPress,
  count,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.chip,
        selected && s.chipSelected,
        pressed && s.pressed,
      ]}
    >
      <Text style={[s.chipText, selected && s.chipTextSelected]}>
        {label}
        {count !== undefined ? ` ${count}` : ""}
      </Text>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: Parameters<typeof toneColors>[0];
}) {
  const { bg, fg } = toneColors(tone);
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ misc */

export function EmptyState({
  icon = "file-tray-outline",
  title,
  message,
  action,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={40} color={colors.textFaint} />
      <Text style={s.emptyTitle}>{title}</Text>
      {message ? <Text style={s.emptyMessage}>{message}</Text> : null}
      {action && onAction ? (
        <Button title={action} onPress={onAction} style={{ marginTop: spacing.md }} />
      ) : null}
    </View>
  );
}

export function Row({
  left,
  right,
  strong,
  tone,
}: {
  left: string;
  right: string;
  strong?: boolean;
  /** Colours both sides - for the one figure on a screen that is the reason
   *  the screen was opened, such as what a party still owes. */
  tone?: "danger";
}) {
  const toned = tone === "danger" ? { color: colors.danger } : null;
  return (
    <View style={s.row}>
      <Text style={[s.rowLeft, strong && s.rowStrong, toned]}>{left}</Text>
      <Text style={[s.rowRight, strong && s.rowStrong, toned]}>{right}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={s.divider} />;
}

export function Loading() {
  return (
    <View style={s.loading}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: font.h1, fontFamily: typeface.bold, color: colors.text },
  subtitle: { fontSize: font.body, fontFamily: typeface.regular, color: colors.textMuted },
  label: {
    fontSize: font.small,
    fontFamily: typeface.semibold,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  muted: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  pressed: { opacity: 0.7 },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  sectionTitle: { fontSize: font.h3, fontFamily: typeface.bold, color: colors.text },
  sectionAction: { fontSize: font.small, fontFamily: typeface.semibold, color: colors.primary },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    // 48 is the smallest comfortable target for a thumb holding a phone in
    // one hand while the other one is counting bags.
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  buttonText: { fontSize: font.body, fontFamily: typeface.bold },
  buttonDisabled: { opacity: 0.45 },
  iconButton: { padding: spacing.xs },

  field: { marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    fontSize: font.body,
    fontFamily: typeface.regular,
    color: colors.text,
  },
  inputMultiline: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: "top" },
  hint: { fontSize: font.tiny, fontFamily: typeface.regular, color: colors.textFaint, marginTop: spacing.xs },
  select: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectValue: { fontSize: font.body, fontFamily: typeface.regular, color: colors.text, flex: 1 },
  selectPlaceholder: { fontSize: font.body, fontFamily: typeface.regular, color: colors.textFaint, flex: 1 },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  searchInput: { flex: 1, fontSize: font.body, fontFamily: typeface.regular, color: colors.text, paddingVertical: 0 },

  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.small, fontFamily: typeface.semibold, color: colors.textMuted },
  chipTextSelected: { color: colors.white },

  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: font.tiny, fontFamily: typeface.bold, textTransform: "uppercase" },

  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyTitle: {
    fontSize: font.h3,
    fontFamily: typeface.bold,
    color: colors.text,
    marginTop: spacing.sm,
  },
  emptyMessage: {
    fontSize: font.small,
    fontFamily: typeface.regular,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  rowLeft: { fontSize: font.body, fontFamily: typeface.regular, color: colors.textMuted, flexShrink: 1 },
  rowRight: { fontSize: font.body, color: colors.text, fontFamily: typeface.semibold },
  rowStrong: { fontSize: font.h3, fontFamily: typeface.heavy, color: colors.text },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  loading: { paddingVertical: spacing.xxl, alignItems: "center" },
});
