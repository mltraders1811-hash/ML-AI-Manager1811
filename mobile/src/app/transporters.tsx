import { useState } from "react";
import { Alert, FlatList, Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  Title,
} from "../components/ui";
import { deleteTransporter, listTransporters, saveTransporter } from "../db/queries";
import { useQuery } from "../hooks/useQuery";
import type { Transporter } from "../lib/types";
import { colors, font, spacing, typeface } from "../theme";

export default function TransportersScreen() {
  const [editing, setEditing] = useState<Transporter | "new" | null>(null);
  const { data: transporters, loading, reload } = useQuery(() => listTransporters(), []);

  return (
    <View style={s.screen}>
      {loading && !transporters ? (
        <Loading />
      ) : (
        <FlatList
          data={transporters ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <Card onPress={() => setEditing(item)} style={s.card}>
              <View style={s.row}>
                <Text style={s.name}>{item.name}</Text>
                <Text style={s.phone}>{item.phone ?? "No phone"}</Text>
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="bus-outline"
              title="No transporters"
              message="Add the transport companies whose gadis carry your goods."
              action="Add transporter"
              onAction={() => setEditing("new")}
            />
          }
        />
      )}

      <View style={s.footer}>
        <Button title="Add transporter" icon="add" onPress={() => setEditing("new")} />
      </View>

      <TransporterEditor
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

function TransporterEditor({
  target,
  onClose,
  onSaved,
}: {
  target: Transporter | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const transporter = target === "new" ? null : target;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ready, setReady] = useState<string | null>(null);

  const key = transporter?.id ?? (target === "new" ? "new" : "");
  if (target && ready !== key) {
    setReady(key);
    setName(transporter?.name ?? "");
    setPhone(transporter?.phone ?? "");
  }

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name needed", "A transporter needs a name.");
      return;
    }
    await saveTransporter({ id: transporter?.id ?? null, name, phone });
    setReady(null);
    onSaved();
  };

  const onDelete = () => {
    if (!transporter) return;
    Alert.alert(
      "Delete this transporter?",
      `${transporter.name} is removed from the list. Challans already issued keep their name.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await deleteTransporter(transporter.id);
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
          <Title>{transporter ? "Edit transporter" : "New transporter"}</Title>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Transport company name"
          />
          <Field
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="10-digit mobile"
            keyboardType="phone-pad"
            hint="Used to send them the challan on WhatsApp."
          />
          <Button title="Save" icon="checkmark" onPress={() => void onSave()} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          {transporter ? (
            <Button title="Delete transporter" variant="ghost" onPress={onDelete} />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, gap: spacing.sm },
  card: { padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: font.h3, fontFamily: typeface.bold, color: colors.text },
  phone: { fontSize: font.body, fontFamily: typeface.bold, color: colors.primary },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  modal: { flex: 1, backgroundColor: colors.bg },
  modalContent: { padding: spacing.lg, gap: spacing.sm },
});
