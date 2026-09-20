import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Card, Chip, Loading, Row, SectionHeader } from "../components/ui";
import {
  brokerSummary,
  getDashboard,
  listOrdersWithLines,
  topItems,
  topParties,
} from "../db/queries";
import { addDays, monthLabel, monthRange, todayISO } from "../lib/date";
import { csvFileName, ordersToCsv } from "../lib/csv";
import { shareTextFile } from "../lib/export";
import { formatINR, formatNumber } from "../lib/money";
import { useQuery } from "../hooks/useQuery";
import { colors, font, spacing } from "../theme";

type RangeKey = "month" | "lastMonth" | "week" | "all";

function resolveRange(key: RangeKey): { from: string; to: string; label: string } {
  const today = todayISO();
  switch (key) {
    case "week":
      return { from: addDays(today, -6), to: today, label: "Last 7 days" };
    case "lastMonth": {
      const thisMonth = monthRange(today);
      const lastDay = addDays(thisMonth.from, -1);
      const last = monthRange(lastDay);
      return { ...last, label: monthLabel(lastDay) };
    }
    case "all":
      // Wide enough to cover any bill this app will ever hold, without
      // needing a separate "no filter" path through every query.
      return { from: "1900-01-01", to: "2999-12-31", label: "All time" };
    default:
      return { ...monthRange(today), label: monthLabel(today) };
  }
}

export default function ReportsScreen() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("month");
  const [exporting, setExporting] = useState(false);
  const range = resolveRange(rangeKey);

  const { data, loading } = useQuery(async () => {
    const [dashboard, parties, items, brokers] = await Promise.all([
      getDashboard(todayISO(), range.from, range.to),
      topParties(range.from, range.to, 10),
      topItems(range.from, range.to, 10),
      brokerSummary(range.from, range.to),
    ]);
    return { dashboard, parties, items, brokers };
  }, [range.from, range.to]);

  const onExport = async () => {
    setExporting(true);
    try {
      const orders = await listOrdersWithLines({ from: range.from, to: range.to });
      if (orders.length === 0) {
        Alert.alert("Nothing to export", "No orders in this period.");
        return;
      }
      await shareTextFile(csvFileName(range.from, range.to), ordersToCsv(orders));
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.chips}>
        {(
          [
            ["month", "This month"],
            ["lastMonth", "Last month"],
            ["week", "Last 7 days"],
            ["all", "All time"],
          ] as [RangeKey, string][]
        ).map(([key, label]) => (
          <Chip
            key={key}
            label={label}
            selected={rangeKey === key}
            onPress={() => setRangeKey(key)}
          />
        ))}
      </View>

      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <Card>
            <Text style={s.rangeLabel}>{range.label}</Text>
            <Row left="Orders" right={String(data?.dashboard.monthOrders ?? 0)} />
            <Row
              left="Sales"
              right={formatINR(data?.dashboard.monthSales ?? 0, { decimals: false })}
              strong
            />
            <Row left="Weight sold" right={`${formatNumber(data?.dashboard.monthKg ?? 0, 0)} kg`} />
            <Row
              left="Still to collect"
              right={formatINR(data?.dashboard.outstanding ?? 0, { decimals: false })}
            />
          </Card>

          <Button
            title="Export to CSV"
            icon="download-outline"
            onPress={() => void onExport()}
            loading={exporting}
          />
          <Text style={s.hint}>
            One row per order line - opens in Excel, Google Sheets or Vyapar's
            import.
          </Text>

          {data && data.items.length > 0 ? (
            <>
              <SectionHeader title="Items sold" />
              <Card style={s.tableCard}>
                {data.items.map((row, i) => (
                  <View key={row.name} style={[s.tableRow, i > 0 && s.tableBorder]}>
                    <View style={s.tableLeft}>
                      <Text style={s.tableName} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={s.tableSub}>
                        {formatNumber(row.kg, 0)} kg · {row.count} time
                        {row.count === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <Text style={s.tableValue}>
                      {formatINR(row.total, { decimals: false })}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {data && data.parties.length > 0 ? (
            <>
              <SectionHeader title="Parties" />
              <Card style={s.tableCard}>
                {data.parties.map((row, i) => (
                  <View key={row.name} style={[s.tableRow, i > 0 && s.tableBorder]}>
                    <View style={s.tableLeft}>
                      <Text style={s.tableName} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={s.tableSub}>
                        {row.count} order{row.count === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <Text style={s.tableValue}>
                      {formatINR(row.total, { decimals: false })}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {data && data.brokers.length > 0 ? (
            <>
              <SectionHeader title="Brokers" />
              <Card style={s.tableCard}>
                {data.brokers.map((row, i) => (
                  <View key={row.name} style={[s.tableRow, i > 0 && s.tableBorder]}>
                    <View style={s.tableLeft}>
                      <Text style={s.tableName} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={s.tableSub}>
                        {row.count} order{row.count === 1 ? "" : "s"}
                        {row.commissionPct > 0
                          ? ` · ${row.commissionPct}% = ${formatINR(row.brokerage, { decimals: false })}`
                          : ""}
                      </Text>
                    </View>
                    <Text style={s.tableValue}>
                      {formatINR(row.total, { decimals: false })}
                    </Text>
                  </View>
                ))}
              </Card>
              <Text style={s.hint}>
                Set a percentage against a broker to see what they have earned.
              </Text>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rangeLabel: {
    fontSize: font.small,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  hint: { fontSize: font.small, color: colors.textMuted },
  tableCard: { padding: spacing.md },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  tableBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  tableLeft: { flex: 1 },
  tableName: { fontSize: font.body, fontWeight: "600", color: colors.text },
  tableSub: { fontSize: font.small, color: colors.textMuted },
  tableValue: { fontSize: font.body, fontWeight: "700", color: colors.text },
});
