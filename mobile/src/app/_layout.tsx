import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Loading } from "../components/ui";
import { getDb } from "../db";
import { colors } from "../theme";

export default function RootLayout() {
  // Migrations and the first-run seed both happen inside getDb(). Opening a
  // screen before they finish would show an empty shop for a frame, so the
  // app waits once, here.
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDb()
      .then(() => setReady(true))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {ready || error ? (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.primary },
              headerTintColor: colors.white,
              headerTitleStyle: { fontWeight: "700" },
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
        ) : (
          <Loading />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
