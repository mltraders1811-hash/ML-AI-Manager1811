import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { OrderCard } from "../../components/OrderCard";
import { Stat } from "../../components/Stat";
import {
  Button,
  Card,
  EmptyState,
  Loading,
  SectionHeader,
} from "../../components/ui";
import {
  getDashboard,
  listOrdersWithLines,
  topItems,
  topParties,
} from "../../db/queries";
import { monthLabel, monthRange, todayISO } from "../../lib/date";
import { formatNumber } from "../../lib/money";
import { useQuery } from "../../hooks/useQuery";
import { colors, font, spacing, typeface } from "../../theme";

/** The home screen is about goods, not money: how many orders are on the
 *  book, what still has to be loaded, and what went out. Rupees live on the
 *  order itself and in Reports. */
export default function HomeScreen() {
  const router = useRouter();
  const today = todayISO();
  const month = monthRange(today);

  const { data, loading } = useQuery(async () => {
    const [dashboard, recent, parties, items] = await Promise.all([
      getDashboard(today, month.from, month.to),
      listOrdersWithLines({ limit: 5 }),
      topParties(month.from, month.to, 5),
      topItems(month.from, month.to, 5),
    ]);
    return { dashboard, recent, parties, items };
  }, [today, month.from, month.to]);

  if (loading && !data) return <Loading />;
  const d = data?.dashboard;
  const plural = (n: number) => (n === 1 ? "order" : "orders");

  return (
    <ScrollView
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Button
        title="New order"
        icon="add-circle"
        onPress={() => router.push("/order/new")}
      />

      <View style={s.statsRow}>
        <Stat
          label="Total orders"
          value={String(d?.totalOrders ?? 0)}
          sub={`${d?.monthOrders ?? 0} this month`}
          icon="receipt"
          onPress={() => router.push("/orders")}
        />
        <Stat
          label="Today's orders"
          value={String(d?.todayOrders ?? 0)}
          sub={
            d?.todayOrders
              ? `${plural(d.todayOrders)} written today`
              : "nothing written yet"
          }
          icon="today"
          tone={colors.info}
          onPress={() => router.push("/orders?date=today")}
        />
      </View>
      <View style={s.statsRow}>
        <Stat
          label="To be delivered"
          value={String(d?.pendingOrders ?? 0)}
          sub={
            d?.pendingOrders
              ? `${formatNumber(d.toDeliverKg, 0)} kg to load`
              : "everything is out"
          }
          icon="cube"
          tone={colors.warning}
          onPress={() => router.push("/orders?status=to-deliver")}
        />
        <Stat
          label="Delivered"
          value={String(d?.deliveredOrders ?? 0)}
          sub={`${d?.deliveredMonthOrders ?? 0} this month`}
          icon="checkmark-done"
          tone={colors.success}
          onPress={() => router.push("/orders?status=delivered")}
        />
      </View>

      <Card style={s.weightCard}>
        <Ionicons name="scale-outline" size={20} color={colors.primary} />
        <Text style={s.weightText}>
          <Text style={s.weightNumber}>
            {formatNumber(d?.monthKg ?? 0, 0)} kg
          </Text>
          {`  sent in ${monthLabel(today)} · ${d?.monthOrders ?? 0} ${plural(d?.monthOrders ?? 0)}`}
        </Text>
      </Card>

      <SectionHeader
        title="Recent orders"
        action="See all"
        onAction={() => router.push("/orders")}
      />
      {data && data.recent.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No orders yet"
          message="Write the first one - the party and item lists are already filled in."
          action="New order"
          onAction={() => router.push("/order/new")}
        />
      ) : (
        <View style={s.list}>
          {data?.recent.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              lines={order.lines}
              showMoney={false}
              onPress={() => router.push(`/order/${order.id}`)}
            />
          ))}
        </View>
      )}

      {data && data.items.length > 0 ? (
        <>
          <SectionHeader title={`Top items · ${monthLabel(today)}`} />
          <Card style={s.tableCard}>
            {data.items.map((row, i) => (
              <View key={row.name} style={[s.tableRow, i > 0 && s.tableRowBorder]}>
                <View style={s.tableNameWrap}>
                  <Text style={s.tableName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={s.tableSub}>
                    {row.count} {plural(row.count)}
                  </Text>
                </View>
                <Text style={s.tableValue}>{formatNumber(row.kg, 0)} kg</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {data && data.parties.length > 0 ? (
        <>
          <SectionHeader title={`Top parties · ${monthLabel(today)}`} />
          <Card style={s.tableCard}>
            {data.parties.map((row, i) => (
              <View key={row.name} style={[s.tableRow, i > 0 && s.tableRowBorder]}>
                <View style={s.tableNameWrap}>
                  <Text style={s.tableName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={s.tableSub}>
                    {row.count} {plural(row.count)}
                  </Text>
                </View>
                <Text style={s.tableValue}>{formatNumber(row.kg, 0)} kg</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Card onPress={() => router.push("/reports")} style={s.linkCard}>
        <Ionicons name="bar-chart" size={20} color={colors.primary} />
        <Text style={s.linkText}>Reports and CSV export</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  list: { gap: spacing.sm },
  weightCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  weightText: { flex: 1, fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted },
  weightNumber: { fontSize: font.body, fontFamily: typeface.heavy, color: colors.text },
  tableCard: { padding: spacing.md, gap: 0 },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  tableRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  tableNameWrap: { flex: 1 },
  tableName: { fontSize: font.body, color: colors.text, fontFamily: typeface.semibold },
  tableSub: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted },
  tableValue: { fontSize: font.body, fontFamily: typeface.bold, color: colors.text },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  linkText: { flex: 1, fontSize: font.body, fontFamily: typeface.semibold, color: colors.text },
});
