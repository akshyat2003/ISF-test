// Runtime configuration. EXPO_PUBLIC_* values are inlined at build time; set them per environment (EAS profiles).
import Constants from "expo-constants";
import { Platform } from "react-native";
import { parseSignInMethods } from "@sj/contracts";

/** In development on a phone, "localhost" is the phone itself: reach the API on the computer running Expo instead. */
function devMachineApi(): string | null {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:4000` : null;
}

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "web" ? "http://localhost:4000" : devMachineApi() ?? "http://localhost:4000");
export const AUTH_MODE: "dev" | "supabase" = process.env.EXPO_PUBLIC_AUTH_MODE === "supabase" ? "supabase" : "dev";
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Public website, for the privacy notice and anything the app links out to. */
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || API_URL.replace(/:4000$/, ":3000");
/** One-time-code channels offered (TBD-12: email at launch, plus mobile once SMS is live). Unset: both (development). */
export const SIGNIN_METHODS = parseSignInMethods(process.env.EXPO_PUBLIC_SIGNIN_METHODS);
