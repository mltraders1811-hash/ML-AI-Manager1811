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
  listOrders,
  topItems,
  topParties,
} from "../../db/queries";
import { monthLabel, monthRange, todayISO } from "../../lib/date";
import { formatINR, formatNumber } from "../../lib/money";
import { useQuery } from "../../hooks/useQuery";
import { colors, font, spacing, typeface } from "../../theme";

export default function HomeScreen() {
  const router = useRouter();
  const today = todayISO();
  const month = monthRange(today);

  const { data, loading } = useQuery(async () => {
    const [dashboard, recent, parties, items] = await Promise.all([
      getDashboard(today, month.from, month.to),
      listOrders({ limit: 5 }),
      topParties(month.from, month.to, 5),
      topItems(month.from, month.to, 5),
    ]);
    return { dashboard, recent, parties, items };
  }, [today, month.from, month.to]);

  if (loading && !data) return <Loading />;
  const d = data?.dashboard;

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
          label="Today"
          value={formatINR(d?.todaySales ?? 0, { decimals: false })}
          sub={`${d?.todayOrders ?? 0} order${d?.todayOrders === 1 ? "" : "s"}`}
          icon="today"
        />
        <Stat
          label="To collect"
          value={formatINR(d?.outstanding ?? 0, { decimals: false })}
          sub={`${d?.unpaidOrders ?? 0} unpaid`}
          icon="wallet"
          tone={colors.danger}
          onPress={() => router.push("/orders?status=unpaid")}
        />
      </View>
      <View style={s.statsRow}>
        <Stat
          label={monthLabel(today)}
          value={formatINR(d?.monthSales ?? 0, { decimals: false })}
          sub={`${d?.monthOrders ?? 0} orders · ${formatNumber(d?.monthKg ?? 0, 0)} kg`}
          icon="stats-chart"
          tone={colors.info}
        />
        <Stat
          label="To deliver"
          value={String(d?.pendingOrders ?? 0)}
          sub="pending or packed"
          icon="cube"
          tone={colors.warning}
          onPress={() => router.push("/orders?status=pending")}
        />
      </View>

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
              onPress={() => router.push(`/order/${order.id}`)}
            />
          ))}
        </View>
      )}

      {data && data.parties.length > 0 ? (
        <>
          <SectionHeader title={`Top parties · ${monthLabel(today)}`} />
          <Card style={s.tableCard}>
            {data.parties.map((row, i) => (
              <View key={row.name} style={[s.tableRow, i > 0 && s.tableRowBorder]}>
                <Text style={s.tableName} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={s.tableValue}>
                  {formatINR(row.total, { decimals: false })}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

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
                  <Text style={s.tableSub}>{formatNumber(row.kg, 0)} kg</Text>
                </View>
                <Text style={s.tableValue}>
                  {formatINR(row.total, { decimals: false })}
                </Text>
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
  tableName: { flex: 1, fontSize: font.body, color: colors.text, fontFamily: typeface.semibold },
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
