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
import { deleteBroker, listBrokers, saveBroker } from "../db/queries";
import { parseAmount } from "../lib/money";
import { useQuery } from "../hooks/useQuery";
import type { Broker } from "../lib/types";
import { colors, font, spacing, typeface } from "../theme";

export default function BrokersScreen() {
  const [editing, setEditing] = useState<Broker | "new" | null>(null);
  const { data: brokers, loading, reload } = useQuery(() => listBrokers(), []);

  return (
    <View style={s.screen}>
      {loading && !brokers ? (
        <Loading />
      ) : (
        <FlatList
          data={brokers ?? []}
          keyExtractor={(b) => b.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <Card onPress={() => setEditing(item)} style={s.card}>
              <View style={s.row}>
                <Text style={s.name}>{item.name}</Text>
                <Text style={s.pct}>
                  {item.commissionPct > 0 ? `${item.commissionPct}%` : "No commission"}
                </Text>
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="person-outline"
              title="No brokers"
              message="Add the brokers who bring you orders, and their cut."
              action="Add broker"
              onAction={() => setEditing("new")}
            />
          }
        />
      )}

      <View style={s.footer}>
        <Button title="Add broker" icon="add" onPress={() => setEditing("new")} />
      </View>

      <BrokerEditor
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

function BrokerEditor({
  target,
  onClose,
  onSaved,
}: {
  target: Broker | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const broker = target === "new" ? null : target;
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const [ready, setReady] = useState<string | null>(null);

  const key = broker?.id ?? (target === "new" ? "new" : "");
  if (target && ready !== key) {
    setReady(key);
    setName(broker?.name ?? "");
    setPct(broker?.commissionPct ? String(broker.commissionPct) : "");
  }

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name needed", "A broker needs a name.");
      return;
    }
    await saveBroker({
      id: broker?.id ?? null,
      name,
      commissionPct: parseAmount(pct),
    });
    setReady(null);
    onSaved();
  };

  const onDelete = () => {
    if (!broker) return;
    Alert.alert(
      "Delete this broker?",
      `${broker.name} is removed from the list. Past orders keep their broker name.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await deleteBroker(broker.id);
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
          <Title>{broker ? "Edit broker" : "New broker"}</Title>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Broker name" />
          <Field
            label="Commission %"
            value={pct}
            onChangeText={setPct}
            placeholder="0"
            keyboardType="decimal-pad"
            hint="Used to work out what they have earned in Reports."
          />
          <Button title="Save" icon="checkmark" onPress={() => void onSave()} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          {broker ? (
            <Button title="Delete broker" variant="ghost" onPress={onDelete} />
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
  pct: { fontSize: font.body, fontFamily: typeface.bold, color: colors.primary },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  modal: { flex: 1, backgroundColor: colors.bg },
  modalContent: { padding: spacing.lg, gap: spacing.sm },
});
