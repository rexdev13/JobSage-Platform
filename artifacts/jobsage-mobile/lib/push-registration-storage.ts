import * as SecureStore from "expo-secure-store";

import { isValidExpoPushToken } from "./native-push";

const REGISTRATION_KEY = "jobsage_native_push_registration_v1";
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type StoredPushRegistration = {
  accountId: string;
  pushToken: string;
};

export async function loadStoredPushRegistration(): Promise<StoredPushRegistration | null> {
  const raw = await SecureStore.getItemAsync(REGISTRATION_KEY, secureOptions);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPushRegistration>;
    if (
      typeof parsed.accountId === "string"
      && parsed.accountId.length > 0
      && typeof parsed.pushToken === "string"
      && isValidExpoPushToken(parsed.pushToken)
    ) {
      return { accountId: parsed.accountId, pushToken: parsed.pushToken };
    }
  } catch {
    // Invalid local state is removed below; it is never used as a device token.
  }
  await SecureStore.deleteItemAsync(REGISTRATION_KEY, secureOptions);
  return null;
}

export async function saveStoredPushRegistration(registration: StoredPushRegistration): Promise<void> {
  if (!registration.accountId || !isValidExpoPushToken(registration.pushToken)) {
    throw new Error("Invalid local push registration.");
  }
  await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify(registration), secureOptions);
}

export async function clearStoredPushRegistration(expected?: StoredPushRegistration): Promise<void> {
  if (expected) {
    const current = await loadStoredPushRegistration();
    if (
      current
      && (current.accountId !== expected.accountId || current.pushToken !== expected.pushToken)
    ) return;
  }
  await SecureStore.deleteItemAsync(REGISTRATION_KEY, secureOptions);
}
