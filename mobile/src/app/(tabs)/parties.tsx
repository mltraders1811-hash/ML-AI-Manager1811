import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Loading,
  SearchBar,
} from "../../components/ui";
import { listPartiesWithBalance } from "../../db/queries";
import { formatINR } from "../../lib/money";
import { useQuery } from "../../hooks/useQuery";
import { colors, font, spacing, typeface } from "../../theme";

export default function PartiesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const { data: parties, loading } = useQuery(
    () => listPartiesWithBalance(search),
    [search],
  );

  const owing = (parties ?? []).reduce((sum, p) => sum + Math.max(p.balance, 0), 0);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or phone"
        />
        {owing > 0 ? (
          <Text style={s.summary}>
            {formatINR(owing, { decimals: false })} outstanding across{" "}
            {(parties ?? []).filter((p) => p.balance > 0).length} parties
          </Text>
        ) : null}
      </View>

      {loading && !parties ? (
        <Loading />
      ) : (
        <FlatList
          data={parties ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/party/${item.id}`)} style={s.card}>
              <View style={s.row}>
                <View style={s.left}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={s.meta}>
                    {item.phone ?? "No phone"} · {item.orderCount} order
                    {item.orderCount === 1 ? "" : "s"}
                  </Text>
                </View>
                {item.balance > 0 ? (
                  <View style={s.right}>
                    <Text style={s.due}>{formatINR(item.balance, { decimals: false })}</Text>
                    <Text style={s.dueLabel}>due</Text>
                  </View>
                ) : item.orderCount > 0 ? (
                  <Badge label="Settled" tone="paid" />
                ) : null}
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={search ? "No party matches" : "No parties yet"}
              message="Add the shops you sell to, so an order takes two taps."
              action="Add party"
              onAction={() => router.push("/party/new")}
            />
          }
        />
      )}

      <View style={s.footer}>
        <Button
          title="Add party"
          icon="person-add"
          onPress={() => router.push("/party/new")}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  summary: { fontSize: font.small, color: colors.danger, fontFamily: typeface.bold },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xxl },
  card: { padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  left: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end" },
  name: { fontSize: font.h3, fontFamily: typeface.bold, color: colors.text },
  meta: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted },
  due: { fontSize: font.h3, fontFamily: typeface.heavy, color: colors.danger },
  dueLabel: { fontSize: font.tiny, fontFamily: typeface.regular, color: colors.textMuted, textTransform: "uppercase" },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
