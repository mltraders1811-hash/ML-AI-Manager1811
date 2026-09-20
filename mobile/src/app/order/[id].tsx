import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
  Loading,
  Row,
} from "../../components/ui";
import {
  addPayment,
  deleteOrder,
  getOrder,
  getParty,
  setOrderStatus,
} from "../../db/queries";
import { formatDateLong } from "../../lib/date";
import { formatINR, formatQty, parseAmount } from "../../lib/money";
import { buildOrderMessage, telLink, waLink } from "../../lib/message";
import {
  nextStatus,
  orderBags,
  orderKg,
  paymentLabel,
  paymentStatus,
  statusLabel,
} from "../../lib/order";
import { useQuery } from "../../hooks/useQuery";
import { getShopName } from "../../lib/settings";
import { colors, font, spacing } from "../../theme";

export default function OrderDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [payment, setPayment] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading, reload } = useQuery(async () => {
    if (!id) return null;
    const order = await getOrder(id);
    if (!order) return null;
    const [party, shopName] = await Promise.all([
      getParty(order.partyId),
      getShopName(),
    ]);
    return { order, party, shopName };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (!data?.order) {
    return (
      <EmptyState
        icon="alert-circle-outline"
        title="Order not found"
        message="It may have been deleted."
        action="Back to orders"
        onAction={() => router.replace("/orders")}
      />
    );
  }

  const { order, party, shopName } = data;
  const pay = paymentStatus(order.total, order.received);
  const next = nextStatus(order.status);
  const message = buildOrderMessage(order, shopName);

  const runBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      Alert.alert("Something went wrong", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onWhatsApp = async () => {
    const url = waLink(party?.phone, message);
    const opened = await Linking.canOpenURL(url);
    if (opened) {
      await Linking.openURL(url);
    } else {
      // No WhatsApp on the phone is not a dead end - the same text can go
      // out through anything else that takes a share.
      await Share.share({ message });
    }
  };

  const onCall = async () => {
    const url = telLink(party?.phone);
    if (!url) {
      Alert.alert("No phone number", `Add a phone number for ${order.partyName} first.`);
      return;
    }
    await Linking.openURL(url);
  };

  const onRecordPayment = () => {
    const amount = parseAmount(payment);
    if (amount <= 0) {
      Alert.alert("Enter an amount", "Type how much was received.");
      return;
    }
    void runBusy(async () => {
      await addPayment(order.id, amount);
      setPayment("");
    });
  };

  const onDelete = () => {
    Alert.alert(
      "Delete this order?",
      `${order.orderNo} for ${order.partyName} will be removed. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await deleteOrder(order.id);
              router.replace("/orders");
            })();
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Card>
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Text style={s.party}>{order.partyName}</Text>
            <Text style={s.meta}>
              {order.orderNo} · {formatDateLong(order.date)}
            </Text>
            {order.brokerName ? (
              <Text style={s.meta}>Broker: {order.brokerName}</Text>
            ) : null}
          </View>
          <View style={s.badges}>
            <Badge label={statusLabel(order.status)} tone={order.status} />
            {order.status !== "cancelled" ? (
              <Badge label={paymentLabel(pay)} tone={pay} />
            ) : null}
          </View>
        </View>

        {party?.phone ? (
          <View style={s.contactRow}>
            <Button
              title="WhatsApp"
              icon="logo-whatsapp"
              variant="secondary"
              onPress={() => void onWhatsApp()}
              style={s.flex}
            />
            <Button
              title="Call"
              icon="call"
              variant="secondary"
              onPress={() => void onCall()}
              style={s.flex}
            />
          </View>
        ) : (
          <Button
            title="Share order"
            icon="share-social"
            variant="secondary"
            onPress={() => void onWhatsApp()}
          />
        )}
      </Card>

      <Card>
        <Text style={s.sectionTitle}>Items</Text>
        {order.lines.map((line) => (
          <View key={line.id} style={s.itemRow}>
            <View style={s.itemLeft}>
              <Text style={s.itemName}>{line.itemName}</Text>
              <Text style={s.itemMeta}>
                {line.bags ? `${formatQty(line.bags)} bags · ` : ""}
                {formatQty(line.qty)} kg × {formatINR(line.rate)}
              </Text>
            </View>
            <Text style={s.itemAmount}>{formatINR(line.amount)}</Text>
          </View>
        ))}

        <Divider />
        <Row left="Subtotal" right={formatINR(order.subtotal)} />
        {order.discount > 0 ? (
          <Row left="Discount" right={`- ${formatINR(order.discount)}`} />
        ) : null}
        <Row left="Total" right={formatINR(order.total)} strong />
        {order.received > 0 ? (
          <Row left="Received" right={formatINR(order.received)} />
        ) : null}
        {order.balance > 0 && order.status !== "cancelled" ? (
          <Row left="Balance due" right={formatINR(order.balance)} strong />
        ) : null}
        <Divider />
        <Row
          left="Weight"
          right={`${formatQty(orderKg(order.lines))} kg${
            orderBags(order.lines) > 0 ? ` · ${formatQty(orderBags(order.lines))} bags` : ""
          }`}
        />
      </Card>

      {order.note ? (
        <Card>
          <Text style={s.sectionTitle}>Note</Text>
          <Text style={s.note}>{order.note}</Text>
        </Card>
      ) : null}

      {order.balance > 0 && order.status !== "cancelled" ? (
        <Card>
          <Text style={s.sectionTitle}>Record a payment</Text>
          <Text style={s.hint}>
            {formatINR(order.balance)} still to collect.
          </Text>
          <View style={s.payRow}>
            <Field
              value={payment}
              onChangeText={setPayment}
              placeholder="Amount received"
              keyboardType="decimal-pad"
              style={s.flex}
            />
            <Button
              title="Add"
              onPress={onRecordPayment}
              loading={busy}
              style={s.payButton}
            />
          </View>
          <Button
            title={`Mark fully paid (${formatINR(order.balance)})`}
            variant="secondary"
            icon="checkmark-done"
            onPress={() => void runBusy(() => addPayment(order.id, order.balance))}
          />
        </Card>
      ) : null}

      <Card>
        <Text style={s.sectionTitle}>Order status</Text>
        {next ? (
          <Button
            title={`Mark ${statusLabel(next).toLowerCase()}`}
            icon="arrow-forward-circle"
            onPress={() => void runBusy(() => setOrderStatus(order.id, next))}
            loading={busy}
          />
        ) : (
          <Text style={s.hint}>
            This order is {statusLabel(order.status).toLowerCase()}.
          </Text>
        )}
        {order.status !== "cancelled" ? (
          <Button
            title="Cancel order"
            variant="ghost"
            onPress={() =>
              Alert.alert("Cancel this order?", "It stays in the list but stops counting towards sales and dues.", [
                { text: "Keep it", style: "cancel" },
                {
                  text: "Cancel order",
                  style: "destructive",
                  onPress: () => void runBusy(() => setOrderStatus(order.id, "cancelled")),
                },
              ])
            }
            style={s.spaced}
          />
        ) : (
          <Button
            title="Restore to pending"
            variant="ghost"
            onPress={() => void runBusy(() => setOrderStatus(order.id, "pending"))}
            style={s.spaced}
          />
        )}
      </Card>

      <View style={s.actions}>
        <Button
          title="Edit"
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push(`/order/new?id=${order.id}`)}
          style={s.flex}
        />
        <Button
          title="Delete"
          icon="trash-outline"
          variant="danger"
          onPress={onDelete}
          style={s.flex}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  headerRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  headerLeft: { flex: 1, gap: 2 },
  party: { fontSize: font.h2, fontWeight: "800", color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
  badges: { gap: spacing.xs, alignItems: "flex-end" },
  contactRow: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  sectionTitle: {
    fontSize: font.h3,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemLeft: { flex: 1, gap: 2 },
  itemName: { fontSize: font.body, fontWeight: "600", color: colors.text },
  itemMeta: { fontSize: font.small, color: colors.textMuted },
  itemAmount: { fontSize: font.body, fontWeight: "700", color: colors.text },
  note: { fontSize: font.body, color: colors.text, lineHeight: 21 },
  hint: { fontSize: font.small, color: colors.textMuted, marginBottom: spacing.sm },
  payRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  payButton: { width: 96 },
  spaced: { marginTop: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
});
