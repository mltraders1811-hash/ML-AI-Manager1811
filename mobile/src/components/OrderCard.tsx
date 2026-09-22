import { StyleSheet, Text, View } from "react-native";

import { relativeDay } from "../lib/date";
import { formatINR } from "../lib/money";
import { paymentLabel, paymentStatus, statusLabel } from "../lib/order";
import type { Order } from "../lib/types";
import { colors, font, spacing, typeface } from "../theme";
import { Badge, Card } from "./ui";

/** One bill in a list: who, how much, and whether the money is in - which is
 *  the whole question the list is scrolled to answer. */
export function OrderCard({
  order,
  onPress,
  showParty = true,
}: {
  order: Order;
  onPress: () => void;
  showParty?: boolean;
}) {
  const pay = paymentStatus(order.total, order.received);
  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.left}>
          {showParty ? (
            <Text style={styles.party} numberOfLines={1}>
              {order.partyName}
            </Text>
          ) : (
            <Text style={styles.party}>{order.orderNo}</Text>
          )}
          <Text style={styles.meta} numberOfLines={1}>
            {relativeDay(order.date)}
            {showParty ? ` · ${order.orderNo}` : ""}
            {order.brokerName ? ` · ${order.brokerName}` : ""}
          </Text>
        </View>
        <Text style={styles.total}>{formatINR(order.total)}</Text>
      </View>

      <View style={styles.badges}>
        <Badge label={statusLabel(order.status)} tone={order.status} />
        {order.status !== "cancelled" ? (
          <Badge label={paymentLabel(pay)} tone={pay} />
        ) : null}
        {order.balance > 0 && order.status !== "cancelled" ? (
          <Text style={styles.due}>{formatINR(order.balance)} due</Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  left: { flex: 1, gap: 2 },
  party: { fontSize: font.h3, fontFamily: typeface.bold, color: colors.text },
  meta: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted },
  total: { fontSize: font.h3, fontFamily: typeface.heavy, color: colors.text },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  due: { fontSize: font.small, fontFamily: typeface.bold, color: colors.danger },
});
