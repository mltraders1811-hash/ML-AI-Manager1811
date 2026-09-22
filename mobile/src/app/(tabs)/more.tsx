import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Card, Field, Loading, SectionHeader } from "../../components/ui";
import { getDb, resetDb } from "../../db";
import { exportBackup, restoreBackup } from "../../db/backup";
import { loadSampleOrders, sampleOrdersLoaded } from "../../db/seed";
import { shareTextFile } from "../../lib/export";
import { todayISO } from "../../lib/date";
import { getShopName, setShopName } from "../../lib/settings";
import { colors, font, radius, spacing, typeface } from "../../theme";

export default function MoreScreen() {
  const router = useRouter();
  const [shopName, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [samplesDone, setSamplesDone] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [name, db] = await Promise.all([getShopName(), getDb()]);
      const done = await sampleOrdersLoaded(db);
      if (!alive) return;
      setName(name);
      setSamplesDone(done);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSaveName = async () => {
    await setShopName(shopName);
    Alert.alert("Saved", "This name goes at the top of every order message.");
  };

  const onBackup = async () => {
    setBusy("backup");
    try {
      const data = await exportBackup();
      await shareTextFile(
        `ml-orders-backup-${todayISO()}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
    } catch (e) {
      Alert.alert("Backup failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      // Android file managers report JSON as any of these, so the filter has
      // to be loose or the backup file simply cannot be selected.
      type: ["application/json", "text/plain", "*/*"],
      copyToCacheDirectory: true,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;

    Alert.alert(
      "Replace everything?",
      "Restoring wipes what is on this phone and puts the backup in its place.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy("restore");
              try {
                const contents = new File(asset.uri).textSync();
                const result = await restoreBackup(contents);
                Alert.alert(
                  "Restored",
                  `${result.orders} orders, ${result.parties} parties and ${result.items} items are back.`,
                );
              } catch (e) {
                Alert.alert(
                  "Restore failed",
                  e instanceof Error ? e.message : String(e),
                );
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  };

  const onSamples = () => {
    void (async () => {
      setBusy("samples");
      try {
        const db = await getDb();
        const written = await loadSampleOrders(db);
        setSamplesDone(true);
        Alert.alert(
          written > 0 ? "Sample orders added" : "Already loaded",
          written > 0
            ? `${written} orders from the July 2026 sale report are now in the book.`
            : "The sample orders are already in the book.",
        );
      } finally {
        setBusy(null);
      }
    })();
  };

  const onReset = () => {
    Alert.alert(
      "Delete everything?",
      "Every order, party and item goes. Take a backup first if you are not sure.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await resetDb();
              setSamplesDone(false);
              Alert.alert("Done", "The app is back to a fresh start.");
            })();
          },
        },
      ],
    );
  };

  if (loading) return <Loading />;

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <SectionHeader title="Shop" />
      <Card>
        <Field
          label="Shop name"
          value={shopName}
          onChangeText={setName}
          placeholder="Your shop's name"
          hint="Appears at the top of the WhatsApp order message."
          style={s.lastField}
        />
        <Button title="Save" onPress={() => void onSaveName()} variant="secondary" />
      </Card>

      <SectionHeader title="Manage" />
      <LinkRow
        icon="bar-chart"
        label="Reports and CSV export"
        onPress={() => router.push("/reports")}
      />
      <LinkRow
        icon="people-circle"
        label="Brokers and commission"
        onPress={() => router.push("/brokers")}
      />

      <SectionHeader title="Backup" />
      <Card>
        <Text style={s.hint}>
          Everything lives on this phone. Take a backup before changing phones,
          and keep it somewhere you can find it - WhatsApp yourself, or Drive.
        </Text>
        <Button
          title="Back up to a file"
          icon="cloud-upload-outline"
          onPress={() => void onBackup()}
          loading={busy === "backup"}
        />
        <Button
          title="Restore from a file"
          icon="cloud-download-outline"
          variant="secondary"
          onPress={() => void onRestore()}
          loading={busy === "restore"}
          style={s.spaced}
        />
      </Card>

      <SectionHeader title="Data" />
      <Card>
        <Text style={s.hint}>
          {samplesDone
            ? "The July 2026 sample orders are loaded. Delete them one by one, or start fresh below."
            : "Load 16 real orders from the July 2026 sale report to see how the app looks with a month of business in it."}
        </Text>
        {!samplesDone ? (
          <Button
            title="Load sample orders"
            icon="download-outline"
            variant="secondary"
            onPress={onSamples}
            loading={busy === "samples"}
          />
        ) : null}
        <Button
          title="Delete all data"
          variant="ghost"
          onPress={onReset}
          style={s.spaced}
        />
      </Card>

      <Text style={s.version}>M.L Orders · offline order book · v1.0.0</Text>
    </ScrollView>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.linkRow, pressed && s.pressed]}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={s.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  lastField: { marginBottom: spacing.md },
  hint: { fontSize: font.small, fontFamily: typeface.regular, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 19 },
  spaced: { marginTop: spacing.sm },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 56,
  },
  pressed: { opacity: 0.7 },
  linkLabel: { flex: 1, fontSize: font.body, fontFamily: typeface.semibold, color: colors.text },
  version: {
    textAlign: "center",
    fontSize: font.tiny,
    fontFamily: typeface.regular,
    color: colors.textFaint,
    marginTop: spacing.xl,
  },
});
