// Push notifications for notices (FR-NOT-02; TBD-52). The app asks for permission once, gets this device's Expo push
// token and registers it with the API for the signed-in account; on sign-out the device is removed again.
// Fails quietly (no push, the in-app inbox still works) when push is not available: web builds, simulators, Expo Go on
// Android (no remote push since SDK 53), or a build without an EAS project id (needs organisation accounts, TBD-36).
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Api } from "@sj/client";
import { secureStorage } from "./storage";

const PUSH_TOKEN_KEY = "sj.push.token";

/** Notices arriving while the app is open are shown as a banner too. */
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type PushSetup = "registered" | "unsupported" | "denied" | "no_project" | "failed";

export async function registerForPush(api: Api): Promise<PushSetup> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("notices", { name: "Event notices", importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return "denied";
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return "no_project";
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.registerPushToken({ token, platform: Platform.OS === "ios" ? "ios" : "android" });
    await secureStorage.set(PUSH_TOKEN_KEY, token);
    return "registered";
  } catch {
    return "failed";
  }
}

/** On sign-out: this device stops receiving the account's notices. Best effort; never blocks signing out. */
export async function unregisterPush(api: Api): Promise<void> {
  const token = await secureStorage.get(PUSH_TOKEN_KEY);
  if (!token) return;
  try { await api.removePushToken(token); } catch { /* signed out anyway; the token is reassigned at the next sign-in */ }
  await secureStorage.remove(PUSH_TOKEN_KEY);
}
