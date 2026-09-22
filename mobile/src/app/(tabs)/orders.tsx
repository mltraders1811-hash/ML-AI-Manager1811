import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { OrderCard } from "../../components/OrderCard";
import { Button, Chip, EmptyState, Loading, SearchBar } from "../../components/ui";
import { listOrders } from "../../db/queries";
import { formatINR } from "../../lib/money";
import { useQuery } from "../../hooks/useQuery";
import type { OrderStatus } from "../../lib/types";
import { colors, font, spacing, typeface } from "../../theme";

type Filter = OrderStatus | "all" | "unpaid";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "pending", label: "Pending" },
  { key: "packed", label: "Packed" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

export default function OrdersScreen() {
  const router = useRouter();
  // The dashboard links here with a filter already chosen ("to collect" ->
  // unpaid), so the tab has to honour the parameter it is opened with.
  const params = useLocalSearchParams<{ status?: string }>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const incoming = params.status;
    if (incoming && FILTERS.some((f) => f.key === incoming)) {
      setFilter(incoming as Filter);
    }
  }, [params.status]);

  const { data: orders, loading } = useQuery(
    () => listOrders({ search, status: filter }),
    [search, filter],
  );

  const total = (orders ?? []).reduce((sum, o) => sum + o.total, 0);
  const due = (orders ?? []).reduce(
    (sum, o) => sum + (o.status === "cancelled" ? 0 : o.balance),
    0,
  );

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Party, order no. or broker"
        />
        <FlatList
          horizontal
          data={FILTERS}
          keyExtractor={(f) => f.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chips}
          renderItem={({ item }) => (
            <Chip
              label={item.label}
              selected={filter === item.key}
              onPress={() => setFilter(item.key)}
            />
          )}
        />
      </View>

      {loading && !orders ? (
        <Loading />
      ) : (
        <FlatList
          data={orders ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onPress={() => router.push(`/order/${item.id}`)}
            />
          )}
          ListHeaderComponent={
            orders && orders.length > 0 ? (
              <View style={s.summary}>
                <Text style={s.summaryText}>
                  {orders.length} order{orders.length === 1 ? "" : "s"} ·{" "}
                  {formatINR(total, { decimals: false })}
                </Text>
                {due > 0 ? (
                  <Text style={s.summaryDue}>
                    {formatINR(due, { decimals: false })} to collect
                  </Text>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title={search ? "Nothing matches" : "No orders here"}
              message={
                search
                  ? "Try a shorter search."
                  : "Orders you write will show up in this list."
              }
            />
          }
        />
      )}

      <View style={s.footer}>
        <Button
          title="New order"
          icon="add"
          onPress={() => router.push("/order/new")}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  summaryText: { fontSize: font.small, color: colors.textMuted, fontFamily: typeface.semibold },
  summaryDue: { fontSize: font.small, color: colors.danger, fontFamily: typeface.bold },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
