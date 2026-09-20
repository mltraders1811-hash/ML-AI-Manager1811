import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { OrderCard } from "../../components/OrderCard";
import {
  Button,
  Card,
  Field,
  Loading,
  Row,
  SectionHeader,
} from "../../components/ui";
import {
  deleteParty,
  getParty,
  listOrders,
  saveParty,
} from "../../db/queries";
import { telLink, waLink } from "../../lib/message";
import { formatINR } from "../../lib/money";
import { colors, font, spacing } from "../../theme";
import type { Order } from "../../lib/types";

export default function PartyScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  // /party/new reuses this screen rather than duplicating the form.
  const isNew = !id || id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    navigation.setOptions({ title: isNew ? "New party" : "Party" });
  }, [navigation, isNew]);

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    void (async () => {
      const [party, partyOrders] = await Promise.all([
        getParty(id),
        listOrders({ partyId: id, limit: 50 }),
      ]);
      if (!alive) return;
      if (party) {
        setName(party.name);
        setPhone(party.phone ?? "");
        setAddress(party.address ?? "");
        setNote(party.note ?? "");
      }
      setOrders(partyOrders);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id, isNew]);

  const outstanding = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.balance, 0);
  const lifetime = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total, 0);

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name needed", "A party needs a name.");
      return;
    }
    setSaving(true);
    try {
      const savedId = await saveParty({
        id: isNew ? null : id,
        name,
        phone,
        address,
        note,
      });
      if (isNew) router.replace(`/party/${savedId}`);
      else router.back();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    Alert.alert("Delete this party?", `${name} will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            const result = await deleteParty(id);
            if (!result.ok) {
              Alert.alert(
                "Cannot delete",
                `${result.reason} Delete those orders first, or keep the party for the record.`,
              );
              return;
            }
            router.replace("/parties");
          })();
        },
      },
    ]);
  };

  if (loading) return <Loading />;

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Party name" />
          <Field
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="10-digit mobile"
            keyboardType="phone-pad"
            hint="Used for the WhatsApp order message and reminders."
          />
          <Field
            label="Address"
            value={address}
            onChangeText={setAddress}
            placeholder="Town or market"
          />
          <Field
            label="Note"
            value={note}
            onChangeText={setNote}
            placeholder="Credit terms, who to ask for..."
            multiline
            style={s.lastField}
          />
        </Card>

        <Button
          title={isNew ? "Add party" : "Save changes"}
          icon="checkmark"
          onPress={() => void onSave()}
          loading={saving}
        />

        {!isNew ? (
          <>
            {phone.trim() ? (
              <View style={s.contactRow}>
                <Button
                  title="WhatsApp"
                  icon="logo-whatsapp"
                  variant="secondary"
                  onPress={() =>
                    void Linking.openURL(waLink(phone, `Namaste ${name.trim()},`))
                  }
                  style={s.flex}
                />
                <Button
                  title="Call"
                  icon="call"
                  variant="secondary"
                  onPress={() => {
                    const url = telLink(phone);
                    if (url) void Linking.openURL(url);
                  }}
                  style={s.flex}
                />
              </View>
            ) : null}

            <Card>
              <Row left="Orders" right={String(orders.length)} />
              <Row left="Business done" right={formatINR(lifetime, { decimals: false })} />
              <Row
                left="Outstanding"
                right={formatINR(outstanding, { decimals: false })}
                strong
              />
            </Card>

            <Button
              title="New order for this party"
              icon="add-circle"
              onPress={() => router.push(`/order/new?partyId=${id}`)}
            />

            <SectionHeader title="Order history" />
            {orders.length === 0 ? (
              <Text style={s.empty}>No orders yet.</Text>
            ) : (
              <View style={s.list}>
                {orders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    showParty={false}
                    onPress={() => router.push(`/order/${order.id}`)}
                  />
                ))}
              </View>
            )}

            <Button
              title="Delete party"
              variant="ghost"
              onPress={onDelete}
              style={s.delete}
            />
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  lastField: { marginBottom: 0 },
  contactRow: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  list: { gap: spacing.sm },
  empty: { fontSize: font.small, color: colors.textMuted },
  delete: { marginTop: spacing.lg },
});
