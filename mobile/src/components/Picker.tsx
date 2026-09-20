import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, font, radius, spacing } from "../theme";
import { Button, EmptyState, SearchBar } from "./ui";

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

/** A full-screen list to choose from. A shop deals with hundreds of parties,
 *  which is far too many for a dropdown, so this is a searchable sheet with
 *  a way to add the missing one without losing the order being written. */
export function Picker({
  visible,
  title,
  options,
  selectedId,
  searchPlaceholder = "Search",
  createLabel,
  onCreate,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId?: string | null;
  searchPlaceholder?: string;
  createLabel?: string;
  onCreate?: (typed: string) => void;
  onSelect: (option: PickerOption) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(term) ||
        (o.sublabel ?? "").toLowerCase().includes(term),
    );
  }, [options, search]);

  const close = () => {
    setSearch("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={s.sheet} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
          <Pressable onPress={close} hitSlop={10}>
            <Ionicons name="close" size={26} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={s.searchWrap}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder={searchPlaceholder}
          />
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setSearch("");
                onSelect(item);
              }}
              style={({ pressed }) => [s.option, pressed && s.pressed]}
            >
              <View style={s.optionText}>
                <Text style={s.optionLabel}>{item.label}</Text>
                {item.sublabel ? (
                  <Text style={s.optionSub}>{item.sublabel}</Text>
                ) : null}
              </View>
              {selectedId === item.id ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="Nothing matches"
              message={
                onCreate
                  ? "Add it below and carry on with the order."
                  : "Try a different search."
              }
            />
          }
        />

        {onCreate && createLabel ? (
          <View style={s.footer}>
            <Button
              title={
                search.trim() ? `${createLabel}: "${search.trim()}"` : createLabel
              }
              icon="add"
              onPress={() => {
                const typed = search.trim();
                setSearch("");
                onCreate(typed);
              }}
            />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { fontSize: font.h2, fontWeight: "700", color: colors.text },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 56,
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: font.body, fontWeight: "600", color: colors.text },
  optionSub: { fontSize: font.small, color: colors.textMuted },
  pressed: { opacity: 0.7 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
