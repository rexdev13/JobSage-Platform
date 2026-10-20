import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Expo Go cannot provide this app's remote push functionality. Do not evaluate
 * expo-notifications there: its native bootstrap can fail before routes load.
 * Installed development and production builds retain the real implementation.
 */
export function getNativeNotifications(): typeof import("expo-notifications") | null {
  if (Platform.OS === "web" || Constants.executionEnvironment === "storeClient") return null;
  return require("expo-notifications") as typeof import("expo-notifications");
}
