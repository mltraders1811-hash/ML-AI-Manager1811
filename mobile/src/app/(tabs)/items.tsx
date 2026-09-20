import { useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  SearchBar,
  Title,
} from "../../components/ui";
import { deleteItem, listItems, saveItem } from "../../db/queries";
import { formatINR, parseAmount } from "../../lib/money";
import { useQuery } from "../../hooks/useQuery";
import type { Item } from "../../lib/types";
import { colors, font, spacing } from "../../theme";

export default function ItemsScreen() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const { data: items, loading, reload } = useQuery(() => listItems(search), [search]);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search items" />
      </View>

      {loading && !items ? (
        <Loading />
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(i) => i.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <Card onPress={() => setEditing(item)} style={s.card}>
              <View style={s.row}>
                <View style={s.left}>
                  <Text style={s.name}>{item.name}</Text>
                  <Text style={s.meta}>
                    {item.kgPerBag} {item.unit} per bag
                  </Text>
                </View>
                <View style={s.right}>
                  <Text style={s.rate}>{formatINR(item.defaultRate)}</Text>
                  <Text style={s.rateLabel}>per {item.unit}</Text>
                </View>
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title={search ? "No item matches" : "No items yet"}
              message="Add what the shop sells, with the rate you usually bill."
              action="Add item"
              onAction={() => setEditing("new")}
            />
          }
        />
      )}

      <View style={s.footer}>
        <Button title="Add item" icon="add" onPress={() => setEditing("new")} />
      </View>

      <ItemEditor
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    </View>
  );
}

/** The add/edit form. A modal rather than a route: an item is four fields,
 *  and coming back to the list with the same search still in place matters
 *  more than a deep link to one item. */
function ItemEditor({
  target,
  onClose,
  onSaved,
}: {
  target: Item | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const item = target === "new" ? null : target;
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [kgPerBag, setKgPerBag] = useState("30");
  const [unit, setUnit] = useState("kg");
  const [ready, setReady] = useState<string | null>(null);

  // Filling state from props on open, without an effect: the modal is keyed
  // by which item it was opened for.
  const key = item?.id ?? (target === "new" ? "new" : "");
  if (target && ready !== key) {
    setReady(key);
    setName(item?.name ?? "");
    setRate(item?.defaultRate ? String(item.defaultRate) : "");
    setKgPerBag(String(item?.kgPerBag ?? 30));
    setUnit(item?.unit ?? "kg");
  }

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name needed", "An item needs a name.");
      return;
    }
    await saveItem({
      id: item?.id ?? null,
      name,
      unit,
      defaultRate: parseAmount(rate),
      kgPerBag: parseAmount(kgPerBag) || 30,
    });
    setReady(null);
    onSaved();
  };

  const onDelete = () => {
    if (!item) return;
    Alert.alert(
      "Delete this item?",
      `${item.name} is removed from the list. Orders that used it keep their line as it is.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await deleteItem(item.id);
              setReady(null);
              onSaved();
            })();
          },
        },
      ],
    );
  };

  return (
    <Modal visible={target !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.modal} edges={["top", "bottom"]}>
        <View style={s.modalContent}>
          <Title>{item ? "Edit item" : "New item"}</Title>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Item name" />
          <Field
            label="Rate per unit"
            value={rate}
            onChangeText={setRate}
            placeholder="0"
            keyboardType="decimal-pad"
            hint="Fills in automatically when this item is added to an order."
          />
          <Field
            label="Unit"
            value={unit}
            onChangeText={setUnit}
            placeholder="kg"
          />
          <Field
            label="Weight per bag"
            value={kgPerBag}
            onChangeText={setKgPerBag}
            placeholder="30"
            keyboardType="decimal-pad"
            hint="Used to turn bags into a suggested weight on an order line."
          />
          <Button title="Save" icon="checkmark" onPress={() => void onSave()} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          {item ? (
            <Button title="Delete item" variant="ghost" onPress={onDelete} />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
  card: { padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  left: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end" },
  name: { fontSize: font.h3, fontWeight: "700", color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
  rate: { fontSize: font.h3, fontWeight: "800", color: colors.primary },
  rateLabel: { fontSize: font.tiny, color: colors.textMuted },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  modal: { flex: 1, backgroundColor: colors.bg },
  modalContent: { padding: spacing.lg, gap: spacing.sm },
});
