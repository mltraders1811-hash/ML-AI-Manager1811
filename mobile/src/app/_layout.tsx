import {
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/manrope";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Button, Loading } from "../components/ui";
import { getDb } from "../db";
import { colors, font, spacing, typeface } from "../theme";

export default function RootLayout() {
  // Migrations and the first-run seed both happen inside getDb(). Opening a
  // screen before they finish would show an empty shop for a frame, so the
  // app waits once, here.
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every text style names a Manrope family by weight, so a screen drawn
  // before they load would fall back to the system font and then jump.
  // A font that fails to load is not worth blocking the app over, though:
  // the system font is a worse bill than a spinner that never ends.
  const [fontsLoaded, fontError] = useFonts({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  const open = useCallback(() => {
    setError(null);
    getDb()
      .then(() => setReady(true))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  useEffect(open, [open]);

  // A database that will not open used to leave a blank screen and a pile of
  // failed queries behind it. Saying what went wrong is the difference
  // between a bug report and a shrug.
  if (error) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={s.errorScreen}>
          <Text style={s.errorTitle}>The order book could not open</Text>
          <Text style={s.errorBody}>{error}</Text>
          <Button title="Try again" icon="refresh" onPress={open} />
        </ScrollView>
      </SafeAreaProvider>
    );
  }

  if (!ready || (!fontsLoaded && !fontError)) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Loading />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          headerTitleStyle: { fontFamily: typeface.bold },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="order/new" options={{ title: "New order" }} />
        <Stack.Screen name="order/[id]" options={{ title: "Order" }} />
        <Stack.Screen name="party/[id]" options={{ title: "Party" }} />
        <Stack.Screen name="brokers" options={{ title: "Brokers" }} />
        <Stack.Screen name="reports" options={{ title: "Reports" }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  errorScreen: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  errorTitle: {
    fontSize: font.h2,
    fontFamily: typeface.heavy,
    color: colors.text,
  },
  errorBody: {
    fontSize: font.body,
    fontFamily: typeface.regular,
    color: colors.textMuted,
    lineHeight: 21,
  },
});
