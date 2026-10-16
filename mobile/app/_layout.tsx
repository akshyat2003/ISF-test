import { Stack, router } from "expo-router";
import { Pressable, Text } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "../components/ui";
import { SessionProvider } from "../lib/session";

/** Always visible (FR-HD-10): every screen's header opens the emergency screen, where 112 is the first control. */
function EmergencyButton() {
  return (
    <Pressable onPress={() => router.push("/emergency")} accessibilityRole="button" accessibilityLabel="Emergency: call 112 or alert the event team"
      hitSlop={10} style={{ backgroundColor: colors.danger, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Emergency</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{
          headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.ink, fontWeight: "700" }, contentStyle: { backgroundColor: colors.bg },
          headerRight: () => <EmergencyButton />,
        }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="signin" options={{ title: "Sign in", headerBackVisible: false }} />
          <Stack.Screen name="activate" options={{ title: "Activate account" }} />
          <Stack.Screen name="home" options={{ title: "Startup Jathara", headerBackVisible: false }} />
          <Stack.Screen name="register" options={{ title: "Register a startup" }} />
          <Stack.Screen name="status" options={{ title: "Application status" }} />
          <Stack.Screen name="notifications" options={{ title: "Messages" }} />
          <Stack.Screen name="jury/index" options={{ title: "Jury" }} />
          <Stack.Screen name="jury/[startupId]" options={{ title: "Startup" }} />
          <Stack.Screen name="volunteer" options={{ title: "Volunteer" }} />
          <Stack.Screen name="event" options={{ title: "Event information" }} />
          <Stack.Screen name="emergency" options={{ title: "Emergency", headerRight: () => null }} />
          <Stack.Screen name="help" options={{ title: "Help" }} />
          <Stack.Screen name="requests" options={{ title: "My requests" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
