import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { Picker, type PickerOption } from "../../components/Picker";
import {
  Button,
  Card,
  Chip,
  Field,
  Label,
  Loading,
  Row,
  SelectField,
} from "../../components/ui";
import {
  getChallanForOrder,
  getOrder,
  getParty,
  listTransporters,
  saveChallan,
  saveTransporter,
} from "../../db/queries";
import {
  buildChallanHtml,
  buildChallanMessage,
  challanFileName,
  type ChallanDoc,
} from "../../lib/challan";
import { addDays, formatDate, parseFlexibleDate, todayISO } from "../../lib/date";
import { waLink } from "../../lib/message";
import { formatQty } from "../../lib/money";
import { orderBags, orderKg } from "../../lib/order";
import { printHtml, sharePdf } from "../../lib/print";
import { getShopProfile } from "../../lib/settings";
import type { Challan, OrderWithLines, Party, ShopProfile, Transporter } from "../../lib/types";
import { colors, font, spacing, typeface } from "../../theme";

export default function ChallanScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [order, setOrder] = useState<OrderWithLines | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [shop, setShop] = useState<ShopProfile | null>(null);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [saved, setSaved] = useState<Challan | null>(null);

  const [transporterId, setTransporterId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [dateText, setDateText] = useState(formatDate(todayISO()));
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [lrNo, setLrNo] = useState("");
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");
  const [showRates, setShowRates] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: "Delivery challan" });
  }, [navigation]);

  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    void (async () => {
      const [loadedOrder, list, profile, existing] = await Promise.all([
        getOrder(orderId),
        listTransporters(),
        getShopProfile(),
        getChallanForOrder(orderId),
      ]);
      const loadedParty = loadedOrder ? await getParty(loadedOrder.partyId) : null;
      if (!alive) return;

      setOrder(loadedOrder);
      setParty(loadedParty);
      setTransporters(list);
      setShop(profile);
      setSaved(existing);

      if (existing) {
        setTransporterId(existing.transporterId);
        setDate(existing.date);
        setDateText(formatDate(existing.date));
        setVehicleNo(existing.vehicleNo ?? "");
        setDriverName(existing.driverName ?? "");
        setDriverPhone(existing.driverPhone ?? "");
        setLrNo(existing.lrNo ?? "");
        setDestination(existing.destination ?? "");
        setNote(existing.note ?? "");
        setShowRates(existing.showRates);
      } else if (loadedParty?.address) {
        // Where the goods are going is nearly always the party's own town.
        setDestination(loadedParty.address);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [orderId]);

  const transporter = transporters.find((t) => t.id === transporterId) ?? null;

  /** The document as it stands, saved or not, so Preview shows what Print
   *  would put on paper rather than the last saved version. */
  const draftDoc = useMemo<ChallanDoc | null>(() => {
    if (!order || !shop) return null;
    return {
      order,
      party,
      shop,
      challan: {
        id: saved?.id ?? "draft",
        challanNo: saved?.challanNo ?? "(not saved yet)",
        orderId: order.id,
        date,
        transporterId: transporter?.id ?? null,
        transporterName: transporter?.name ?? null,
        transporterPhone: transporter?.phone ?? null,
        vehicleNo: vehicleNo.trim() || null,
        driverName: driverName.trim() || null,
        driverPhone: driverPhone.trim() || null,
        lrNo: lrNo.trim() || null,
        destination: destination.trim() || null,
        note: note.trim() || null,
        showRates,
        createdAt: saved?.createdAt ?? "",
        updatedAt: saved?.updatedAt ?? "",
      },
    };
  }, [
    order, party, shop, saved, date, transporter, vehicleNo, driverName,
    driverPhone, lrNo, destination, note, showRates,
  ]);

  const persist = async (): Promise<ChallanDoc | null> => {
    if (!order || !shop) return null;
    const challan = await saveChallan({
      orderId: order.id,
      date,
      transporterId: transporter?.id ?? null,
      transporterName: transporter?.name ?? null,
      transporterPhone: transporter?.phone ?? null,
      vehicleNo: vehicleNo.trim() || null,
      driverName: driverName.trim() || null,
      driverPhone: driverPhone.trim() || null,
      lrNo: lrNo.trim() || null,
      destination: destination.trim() || null,
      note: note.trim() || null,
      showRates,
    });
    setSaved(challan);
    return { order, party, shop, challan };
  };

  /** Every action saves first: a challan that was printed but not recorded is
   *  a number nobody can look up when the party rings about the lorry. */
  const run = async (key: string, fn: (doc: ChallanDoc) => Promise<void>) => {
    if (!order) return;
    if (order.lines.length === 0) {
      Alert.alert("Nothing to send", "This order has no items on it.");
      return;
    }
    setBusy(key);
    try {
      const doc = await persist();
      if (doc) await fn(doc);
    } catch (e) {
      Alert.alert("Could not do that", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const applyDateText = (text: string) => {
    setDateText(text);
    const parsed = parseFlexibleDate(text);
    if (parsed) setDate(parsed);
  };

  const setQuickDate = (iso: string) => {
    setDate(iso);
    setDateText(formatDate(iso));
  };

  const createTransporter = async (typed: string) => {
    if (!typed) {
      Alert.alert("Name needed", "Type the transporter's name in the search box first.");
      return;
    }
    const id = await saveTransporter({ name: typed });
    setTransporters(await listTransporters());
    setTransporterId(id);
    setPickerOpen(false);
  };

  if (loading) return <Loading />;
  if (!order || !shop) {
    return (
      <View style={s.screen}>
        <Text style={s.missing}>That order could not be found.</Text>
      </View>
    );
  }

  const options: PickerOption[] = transporters.map((t) => ({
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
          <Text style={s.party}>{order.partyName}</Text>
          <Text style={s.meta}>
            {order.orderNo}
            {saved ? ` · Challan ${saved.challanNo}` : " · challan not issued yet"}
          </Text>
          <Row
            left="Going out"
            right={`${formatQty(orderBags(order.lines))} bags · ${formatQty(orderKg(order.lines))} kg`}
            strong
          />
        </Card>

        <Card>
          <SelectField
            label="Transporter"
            value={transporter?.name ?? null}
            placeholder="Choose a transporter"
            onPress={() => setPickerOpen(true)}
            onClear={() => setTransporterId(null)}
          />
          <Field
            label="Vehicle / gadi no."
            value={vehicleNo}
            onChangeText={(t) => setVehicleNo(t.toUpperCase())}
            placeholder="MP 17 AB 1234"
            autoCapitalize="characters"
          />
          <Field
            label="LR / builty no."
            value={lrNo}
            onChangeText={setLrNo}
            placeholder="Transporter's own receipt no."
          />
          <Field
            label="Driver name"
            value={driverName}
            onChangeText={setDriverName}
            placeholder="Driver's name"
          />
          <Field
            label="Driver phone"
            value={driverPhone}
            onChangeText={setDriverPhone}
            placeholder="10-digit mobile"
            keyboardType="phone-pad"
            style={s.lastField}
          />
        </Card>

        <Card>
          <Field
            label="Destination"
            value={destination}
            onChangeText={setDestination}
            placeholder="Town the goods are going to"
          />
          <Field
            label="Challan date"
            value={dateText}
            onChangeText={applyDateText}
            placeholder="dd/mm/yyyy"
            keyboardType="numbers-and-punctuation"
          />
          <View style={s.chipRow}>
            <Chip label="Today" onPress={() => setQuickDate(todayISO())} />
            <Chip label="Yesterday" onPress={() => setQuickDate(addDays(todayISO(), -1))} />
          </View>
          <Field
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Packing marks, instructions for the driver..."
            multiline
            style={s.lastField}
          />
        </Card>

        <Card>
          <View style={s.switchRow}>
            <View style={s.switchText}>
              <Label>Print rates and amounts</Label>
              <Text style={s.hint}>
                Off by default: the copy that goes with the gadi shows bags,
                packing and weight, the way it is written by hand today.
              </Text>
            </View>
            <Switch
              value={showRates}
              onValueChange={setShowRates}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={colors.white}
            />
          </View>
        </Card>

        <Button
          title="Print challan"
          icon="print"
          onPress={() => void run("print", (doc) => printHtml(buildChallanHtml(doc)))}
          loading={busy === "print"}
        />
        <Button
          title="Send PDF to transporter"
          icon="share-outline"
          variant="secondary"
          onPress={() =>
            void run("pdf", (doc) =>
              sharePdf(buildChallanHtml(doc), challanFileName(doc.challan.challanNo)),
            )
          }
          loading={busy === "pdf"}
        />
        <Button
          title="Send details on WhatsApp"
          icon="logo-whatsapp"
          variant="secondary"
          onPress={() =>
            void run("wa", async (doc) => {
              // The driver's own number first: he is the one at the gate.
              const to = doc.challan.driverPhone || doc.challan.transporterPhone;
              await Linking.openURL(waLink(to, buildChallanMessage(doc)));
            })
          }
          loading={busy === "wa"}
        />
        <Button
          title={saved ? "Save changes" : "Save challan"}
          icon="checkmark"
          variant="secondary"
          onPress={() =>
            void run("save", async () => {
              router.back();
            })
          }
          loading={busy === "save"}
        />
      </ScrollView>

      <Picker
        visible={pickerOpen}
        title="Choose transporter"
        searchPlaceholder="Search transporters"
        options={options}
        selectedId={transporterId}
        createLabel="Add transporter"
        onCreate={(typed) => void createTransporter(typed)}
        onSelect={(o) => {
          setTransporterId(o.id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  party: { fontSize: font.h2, fontFamily: typeface.heavy, color: colors.text },
  meta: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted, marginBottom: spacing.sm },
  lastField: { marginBottom: 0 },
  chipRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switchText: { flex: 1 },
  hint: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted },
  missing: { padding: spacing.xl, fontSize: font.body, fontFamily: typeface.regular, color: colors.textMuted },
});
