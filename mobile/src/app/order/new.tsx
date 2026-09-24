import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Picker, type PickerOption } from "../../components/Picker";
import {
  Button,
  Card,
  Chip,
  Field,
  IconButton,
  Label,
  Loading,
  SelectField,
} from "../../components/ui";
import {
  getOrder,
  listBrokers,
  listItems,
  listParties,
  listTransporters,
  saveItem,
  saveOrder,
  saveParty,
  saveTransporter,
} from "../../db/queries";
import { formatDate, parseFlexibleDate, todayISO, addDays } from "../../lib/date";
import { uid } from "../../lib/id";
import { formatINR, parseAmount } from "../../lib/money";
import {
  bagsToKg,
  computeTotals,
  lineAmount,
  statusLabel,
  usableLines,
  validateDraft,
} from "../../lib/order";
import {
  ORDER_STATUSES,
  type Broker,
  type DraftLine,
  type Item,
  type OrderStatus,
  type Party,
  type Transporter,
} from "../../lib/types";
import { colors, font, radius, spacing, typeface } from "../../theme";

const emptyLine = (): DraftLine => ({
  key: uid("d_"),
  itemId: null,
  itemName: "",
  bags: "",
  qty: "",
  rate: "",
});

type OpenPicker =
  | { kind: "party" }
  | { kind: "broker" }
  | { kind: "transporter" }
  | { kind: "item"; key: string }
  | null;

export default function OrderFormScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string; partyId?: string }>();
  const editingId = params.id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);

  const [partyId, setPartyId] = useState<string | null>(params.partyId ?? null);
  const [brokerId, setBrokerId] = useState<string | null>(null);
  // Noted here so the challan needs no form of its own.
  const [transporterId, setTransporterId] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState("");
  const [date, setDate] = useState(todayISO());
  const [dateText, setDateText] = useState(formatDate(todayISO()));
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("");
  const [received, setReceived] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [picker, setPicker] = useState<OpenPicker>(null);

  useEffect(() => {
    navigation.setOptions({ title: editingId ? "Edit order" : "New order" });
  }, [navigation, editingId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [p, i, b, t] = await Promise.all([
        listParties(),
        listItems(),
        listBrokers(),
        listTransporters(),
      ]);
      if (!alive) return;
      setParties(p);
      setItems(i);
      setBrokers(b);
      setTransporters(t);

      if (editingId) {
        const order = await getOrder(editingId);
        if (order && alive) {
          setPartyId(order.partyId);
          setBrokerId(order.brokerId);
          setTransporterId(order.transporterId);
          setVehicleNo(order.vehicleNo ?? "");
          setDate(order.date);
          setDateText(formatDate(order.date));
          setStatus(order.status);
          setNote(order.note ?? "");
          setDiscount(order.discount ? String(order.discount) : "");
          setReceived(order.received ? String(order.received) : "");
          setLines(
            order.lines.length
              ? order.lines.map((l) => ({
                  key: uid("d_"),
                  itemId: l.itemId,
                  itemName: l.itemName,
                  bags: l.bags ? String(l.bags) : "",
                  qty: String(l.qty),
                  rate: String(l.rate),
                }))
              : [emptyLine()],
          );
        }
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [editingId]);

  const party = parties.find((p) => p.id === partyId) ?? null;
  const broker = brokers.find((b) => b.id === brokerId) ?? null;
  const transporter = transporters.find((t) => t.id === transporterId) ?? null;

  const totals = useMemo(
    () =>
      computeTotals(
        usableLines(lines).map((l) => ({
          qty: parseAmount(l.qty),
          rate: parseAmount(l.rate),
        })),
        parseAmount(discount),
        parseAmount(received),
      ),
    [lines, discount, received],
  );

  const patchLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  };

  const chooseItem = (key: string, item: Item) => {
    const line = lines.find((l) => l.key === key);
    const bags = parseAmount(line?.bags ?? "");
    patchLine(key, {
      itemId: item.id,
      itemName: item.name,
      // The last rate billed is almost always the right one, and it is still
      // one tap away from being changed.
      rate: item.defaultRate ? String(item.defaultRate) : (line?.rate ?? ""),
      qty: bags > 0 ? String(bagsToKg(bags, item.kgPerBag)) : (line?.qty ?? ""),
    });
  };

  const changeBags = (key: string, text: string) => {
    const line = lines.find((l) => l.key === key);
    const item = items.find((i) => i.id === line?.itemId);
    const bags = parseAmount(text);
    // Bags are a shortcut for filling in kilos; the scale decides the real
    // weight, so the suggestion never overwrites a figure already typed by
    // hand unless it came from this same shortcut.
    const suggested =
      item && bags > 0 ? String(bagsToKg(bags, item.kgPerBag)) : undefined;
    const qtyWasSuggested =
      !line?.qty ||
      (item && line.bags && line.qty === String(bagsToKg(parseAmount(line.bags), item.kgPerBag)));
    patchLine(key, {
      bags: text,
      ...(suggested && qtyWasSuggested ? { qty: suggested } : {}),
    });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const removeLine = (key: string) =>
    setLines((prev) =>
      prev.length === 1 ? [emptyLine()] : prev.filter((l) => l.key !== key),
    );

  const applyDateText = (text: string) => {
    setDateText(text);
    const parsed = parseFlexibleDate(text);
    if (parsed) setDate(parsed);
  };

  const setQuickDate = (iso: string) => {
    setDate(iso);
    setDateText(formatDate(iso));
  };

  const onSave = async () => {
    const validation = validateDraft({ partyId, date, lines });
    if (!validation.ok || !party) {
      Alert.alert("Check the order", validation.errors.join("\n"));
      return;
    }
    setSaving(true);
    try {
      const id = await saveOrder({
        id: editingId,
        partyId: party.id,
        partyName: party.name,
        brokerId: broker?.id ?? null,
        brokerName: broker?.name ?? null,
        date,
        status,
        note: note.trim() || null,
        transporterId: transporter?.id ?? null,
        transporterName: transporter?.name ?? null,
        vehicleNo: vehicleNo.trim() || null,
        discount: parseAmount(discount),
        received: parseAmount(received),
        lines: usableLines(lines).map((l) => ({
          itemId: l.itemId,
          itemName: l.itemName.trim(),
          bags: l.bags ? parseAmount(l.bags) : null,
          qty: parseAmount(l.qty),
          rate: parseAmount(l.rate),
        })),
      });
      // replace, not push: going back from the saved order should land on the
      // list, not on the form that just saved it.
      router.replace(`/order/${id}`);
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const createParty = async (typed: string) => {
    if (!typed) {
      Alert.alert("Name needed", "Type the party's name in the search box first.");
      return;
    }
    const id = await saveParty({ name: typed });
    setParties(await listParties());
    setPartyId(id);
    setPicker(null);
  };

  const createTransporter = async (typed: string) => {
    if (!typed) {
      Alert.alert("Name needed", "Type the transporter's name in the search box first.");
      return;
    }
    const id = await saveTransporter({ name: typed });
    setTransporters(await listTransporters());
    setTransporterId(id);
    setPicker(null);
  };

  const createItem = async (key: string, typed: string) => {
    if (!typed) {
      Alert.alert("Name needed", "Type the item's name in the search box first.");
      return;
    }
    const id = await saveItem({ name: typed, defaultRate: 0, kgPerBag: 30 });
    const fresh = await listItems();
    setItems(fresh);
    const created = fresh.find((i) => i.id === id);
    if (created) chooseItem(key, created);
    setPicker(null);
  };

  if (loading) return <Loading />;

  const partyOptions: PickerOption[] = parties.map((p) => ({
    id: p.id,
    label: p.name,
    sublabel: p.phone ?? undefined,
  }));
  const itemOptions: PickerOption[] = items.map((i) => ({
    id: i.id,
    label: i.name,
    sublabel: i.defaultRate ? `${formatINR(i.defaultRate)} / ${i.unit}` : undefined,
  }));
  const brokerOptions: PickerOption[] = brokers.map((b) => ({
    id: b.id,
    label: b.name,
    sublabel: b.commissionPct ? `${b.commissionPct}%` : undefined,
  }));
  const transporterOptions: PickerOption[] = transporters.map((t) => ({
    id: t.id,
    label: t.name,
    sublabel: t.phone ?? undefined,
  }));

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Card>
          <SelectField
            label="Party"
            value={party?.name ?? null}
            placeholder="Choose a party"
            onPress={() => setPicker({ kind: "party" })}
          />

          <Field
            label="Date"
            value={dateText}
            onChangeText={applyDateText}
            placeholder="dd/mm/yyyy"
            keyboardType="numbers-and-punctuation"
          />
          <View style={s.chipRow}>
            <Chip label="Today" onPress={() => setQuickDate(todayISO())} />
            <Chip
              label="Yesterday"
              onPress={() => setQuickDate(addDays(todayISO(), -1))}
            />
          </View>

          <SelectField
            label="Broker (optional)"
            value={broker?.name ?? null}
            placeholder="No broker"
            onPress={() => setPicker({ kind: "broker" })}
            onClear={() => setBrokerId(null)}
          />

          <SelectField
            label="Transporter (optional)"
            value={transporter?.name ?? null}
            placeholder="No transporter"
            onPress={() => setPicker({ kind: "transporter" })}
            onClear={() => setTransporterId(null)}
          />
          <Field
            label="Vehicle / gadi no. (optional)"
            value={vehicleNo}
            onChangeText={(t) => setVehicleNo(t.toUpperCase())}
            placeholder="MP 17 AB 1234"
            autoCapitalize="characters"
            hint="Printed on the challan that goes with the goods."
            style={s.lastField}
          />
        </Card>

        <Text style={s.heading}>Items</Text>
        {lines.map((line, index) => {
          const qty = parseAmount(line.qty);
          const rate = parseAmount(line.rate);
          return (
            <Card key={line.key} style={s.lineCard}>
              <View style={s.lineHeader}>
                <Text style={s.lineNumber}>Item {index + 1}</Text>
                <IconButton
                  icon="trash-outline"
                  onPress={() => removeLine(line.key)}
                  color={colors.danger}
                  size={18}
                />
              </View>

              <SelectField
                value={line.itemName || null}
                placeholder="Choose an item"
                onPress={() => setPicker({ kind: "item", key: line.key })}
              />

              <View style={s.lineInputs}>
                <Field
                  label="Bags"
                  value={line.bags}
                  onChangeText={(t) => changeBags(line.key, t)}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  style={s.lineInput}
                />
                <Field
                  label="Qty (kg)"
                  value={line.qty}
                  onChangeText={(t) => patchLine(line.key, { qty: t })}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  style={s.lineInput}
                />
                <Field
                  label="Rate / kg"
                  value={line.rate}
                  onChangeText={(t) => patchLine(line.key, { rate: t })}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  style={s.lineInput}
                />
              </View>

              <View style={s.lineTotal}>
                <Text style={s.lineTotalLabel}>Amount</Text>
                <Text style={s.lineTotalValue}>
                  {formatINR(lineAmount(qty, rate))}
                </Text>
              </View>
            </Card>
          );
        })}

        <Pressable onPress={addLine} style={({ pressed }) => [s.addLine, pressed && s.pressed]}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={s.addLineText}>Add another item</Text>
        </Pressable>

        <Text style={s.heading}>Payment</Text>
        <Card>
          <View style={s.lineInputs}>
            <Field
              label="Discount"
              value={discount}
              onChangeText={setDiscount}
              placeholder="0"
              keyboardType="decimal-pad"
              style={s.lineInput}
            />
            <Field
              label="Received now"
              value={received}
              onChangeText={setReceived}
              placeholder="0"
              keyboardType="decimal-pad"
              style={s.lineInput}
            />
          </View>

          <Label>Status</Label>
          <View style={s.chipRow}>
            {ORDER_STATUSES.map((value) => (
              <Chip
                key={value}
                label={statusLabel(value)}
                selected={status === value}
                onPress={() => setStatus(value)}
              />
            ))}
          </View>

          <Field
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Vehicle number, packing instructions..."
            multiline
            style={s.noteField}
          />
        </Card>
      </ScrollView>

      <View style={s.footer}>
        <View style={s.footerTotals}>
          <View>
            <Text style={s.footerLabel}>Total</Text>
            <Text style={s.footerValue}>{formatINR(totals.total)}</Text>
          </View>
          {totals.balance !== totals.total ? (
            <View style={s.footerRight}>
              <Text style={s.footerLabel}>Balance</Text>
              <Text style={s.footerBalance}>{formatINR(totals.balance)}</Text>
            </View>
          ) : null}
        </View>
        <Button
          title={editingId ? "Save changes" : "Save order"}
          icon="checkmark"
          onPress={onSave}
          loading={saving}
        />
      </View>

      <Picker
        visible={picker?.kind === "party"}
        title="Choose party"
        searchPlaceholder="Search parties"
        options={partyOptions}
        selectedId={partyId}
        createLabel="Add party"
        onCreate={createParty}
        onSelect={(o) => {
          setPartyId(o.id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <Picker
        visible={picker?.kind === "broker"}
        title="Choose broker"
        searchPlaceholder="Search brokers"
        options={brokerOptions}
        selectedId={brokerId}
        onSelect={(o) => {
          setBrokerId(o.id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <Picker
        visible={picker?.kind === "transporter"}
        title="Choose transporter"
        searchPlaceholder="Search transporters"
        options={transporterOptions}
        selectedId={transporterId}
        createLabel="Add transporter"
        onCreate={(typed) => void createTransporter(typed)}
        onSelect={(o) => {
          setTransporterId(o.id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <Picker
        visible={picker?.kind === "item"}
        title="Choose item"
        searchPlaceholder="Search items"
        options={itemOptions}
        selectedId={
          picker?.kind === "item"
            ? (lines.find((l) => l.key === picker.key)?.itemId ?? null)
            : null
        }
        createLabel="Add item"
        onCreate={(typed) => {
          if (picker?.kind === "item") void createItem(picker.key, typed);
        }}
        onSelect={(o) => {
          if (picker?.kind !== "item") return;
          const item = items.find((i) => i.id === o.id);
          if (item) chooseItem(picker.key, item);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  heading: {
    fontSize: font.h3,
    fontFamily: typeface.bold,
    color: colors.text,
    marginTop: spacing.sm,
  },
  chipRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginBottom: spacing.md },
  lineCard: { padding: spacing.md },
  lineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  lineNumber: {
    fontSize: font.small,
    fontFamily: typeface.bold,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  lineInputs: { flexDirection: "row", gap: spacing.sm },
  lineInput: { flex: 1 },
  noteField: { marginBottom: 0 },
  lastField: { marginBottom: 0 },
  lineTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  lineTotalLabel: { fontSize: font.small, fontFamily: typeface.semibold, color: colors.primaryDark },
  lineTotalValue: { fontSize: font.h3, fontFamily: typeface.heavy, color: colors.primaryDark },
  addLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.primary,
  },
  addLineText: { fontSize: font.body, fontFamily: typeface.bold, color: colors.primary },
  pressed: { opacity: 0.7 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  footerTotals: { flexDirection: "row", justifyContent: "space-between" },
  footerRight: { alignItems: "flex-end" },
  footerLabel: { fontSize: font.small, color: colors.textMuted, fontFamily: typeface.semibold },
  footerValue: { fontSize: font.h1, fontFamily: typeface.heavy, color: colors.text },
  footerBalance: { fontSize: font.h1, fontFamily: typeface.heavy, color: colors.danger },
});
