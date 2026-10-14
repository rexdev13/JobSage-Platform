import type { PushDeviceInput, PushDeviceRevokeInput } from "@workspace/api-client-react";

const PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export function isValidExpoPushToken(token: string): boolean {
  return PUSH_TOKEN.test(token);
}

export function hasEnabledNotificationCategory(
  choices: Record<string, unknown> | null | undefined,
): boolean {
  return !!choices && Object.values(choices).some((value) => value === true);
}

export function createPushPrivacyHeaders(accountId: string, token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "x-jobsage-privacy-account": accountId,
  };
}

export async function registerNativePushToken(
  input: PushDeviceInput,
  options: {
    accountId: string;
    authToken: string;
    register: (body: PushDeviceInput, request: RequestInit) => Promise<unknown>;
  },
): Promise<void> {
  if (!isValidExpoPushToken(input.token) || !["ios", "android"].includes(input.platform)) {
    throw new Error("The device returned an invalid push registration.");
  }
  await options.register(input, {
    headers: createPushPrivacyHeaders(options.accountId, options.authToken),
  });
}

export async function revokeNativePushToken(
  input: PushDeviceRevokeInput,
  options: {
    accountId: string;
    authToken: string;
    revoke: (body: PushDeviceRevokeInput, request: RequestInit) => Promise<unknown>;
  },
): Promise<void> {
  if (input.token && !isValidExpoPushToken(input.token)) {
    throw new Error("The device returned an invalid push registration.");
  }
  await options.revoke(input, {
    headers: createPushPrivacyHeaders(options.accountId, options.authToken),
  });
}
