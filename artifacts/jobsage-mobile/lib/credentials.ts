import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "jobsage_auth_token";
const LEGACY_USER_KEY = "jobsage_auth_user";
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// Web previews deliberately keep bearer credentials in memory, not localStorage.
let webCredential: string | null = null;

export async function readCredential(): Promise<string | null> {
  if (Platform.OS === "web") {
    await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_USER_KEY]);
    return webCredential;
  }
  const stored = await SecureStore.getItemAsync(TOKEN_KEY, options);
  if (stored) {
    await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_USER_KEY]);
    return stored;
  }
  const legacy = await AsyncStorage.getItem(TOKEN_KEY);
  if (!legacy) {
    await AsyncStorage.removeItem(LEGACY_USER_KEY);
    return null;
  }
  // Never remove the only copy until the protected write succeeds. Fail closed
  // if the keystore is unavailable; do not fall back to plaintext persistence.
  await SecureStore.setItemAsync(TOKEN_KEY, legacy, options);
  await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_USER_KEY]);
  return legacy;
}

export async function writeCredential(token: string): Promise<void> {
  if (Platform.OS === "web") webCredential = token;
  else await SecureStore.setItemAsync(TOKEN_KEY, token, options);
  await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_USER_KEY]);
}

export async function clearCredential(): Promise<void> {
  webCredential = null;
  try {
    if (Platform.OS !== "web") await SecureStore.deleteItemAsync(TOKEN_KEY, options);
  } finally {
    await AsyncStorage.multiRemove([TOKEN_KEY, LEGACY_USER_KEY]);
  }
}
