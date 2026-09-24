import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { relativeDay } from "../lib/date";
import { formatINR, formatNumber } from "../lib/money";
import {
  goodsSummary,
  orderBags,
  orderKg,
  paymentLabel,
  paymentStatus,
  statusLabel,
} from "../lib/order";
import type { Order, OrderLine } from "../lib/types";
import { colors, font, radius, spacing, typeface } from "../theme";
import { Badge, Card } from "./ui";

/** One bill in a list. Two readings of the same row: with `showMoney` it
 *  answers "is the money in", and with `lines` it answers "what is going out",
 *  which is the question the home screen is scrolled to answer. */
export function OrderCard({
  order,
  onPress,
  showParty = true,
  lines,
  showMoney = true,
}: {
  order: Order;
  onPress: () => void;
  showParty?: boolean;
  lines?: OrderLine[];
  showMoney?: boolean;
}) {
  const pay = paymentStatus(order.total, order.received);
  const kg = lines ? orderKg(lines) : 0;
  const bags = lines ? orderBags(lines) : 0;

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
        {showMoney ? (
          <Text style={styles.total}>{formatINR(order.total)}</Text>
        ) : null}
      </View>

      {lines ? (
        <View style={styles.goods}>
          <Ionicons name="cube-outline" size={16} color={colors.primary} />
          <Text style={styles.goodsText} numberOfLines={2}>
            {goodsSummary(lines)}
          </Text>
        </View>
      ) : null}

      <View style={styles.badges}>
        <Badge label={statusLabel(order.status)} tone={order.status} />
        {showMoney ? (
          <>
            {order.status !== "cancelled" ? (
              <Badge label={paymentLabel(pay)} tone={pay} />
            ) : null}
            {order.balance > 0 && order.status !== "cancelled" ? (
              <Text style={styles.due}>{formatINR(order.balance)} due</Text>
            ) : null}
          </>
        ) : lines ? (
          <Text style={styles.qty}>
            {formatNumber(kg, 0)} kg
            {bags > 0 ? ` · ${formatNumber(bags, 0)} नग` : ""}
          </Text>
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
  goods: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  goodsText: {
    flex: 1,
    fontSize: font.small,
    fontFamily: typeface.semibold,
    color: colors.primaryDark,
  },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  due: { fontSize: font.small, fontFamily: typeface.bold, color: colors.danger },
  qty: { fontSize: font.small, fontFamily: typeface.bold, color: colors.textMuted },
});
