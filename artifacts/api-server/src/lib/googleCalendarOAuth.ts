import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60_000;
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
].join(" ");

function secretKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for Google Calendar OAuth.");
  return scryptSync(secret, "jobsage-google-calendar-oauth", 32);
}

export function encryptGoogleRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptGoogleRefreshToken(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Invalid stored Google Calendar token.");
  }
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

type OAuthState = {
  userId: string;
  returnPath: string;
  expiresAt: number;
  nonce: string;
};

export function createGoogleOAuthState(input: { userId: string; returnPath: string }): string {
  const payload: OAuthState = {
    ...input,
    expiresAt: Date.now() + STATE_TTL_MS,
    nonce: randomBytes(18).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secretKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyGoogleOAuthState(value: string): OAuthState {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) throw new Error("Invalid Google Calendar OAuth state.");
  const expected = createHmac("sha256", secretKey()).update(encoded).digest();
  const provided = Buffer.from(signature, "base64url");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new Error("Invalid Google Calendar OAuth state.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
  if (!payload.userId || !payload.expiresAt || payload.expiresAt < Date.now()) {
    throw new Error("Expired Google Calendar OAuth state.");
  }
  return payload;
}

export function googleCalendarOAuthRedirectUri(): string {
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (!redirectUri) {
    throw new Error("GOOGLE_CALENDAR_REDIRECT_URI is not configured.");
  }
  return redirectUri;
}

export function googleCalendarAuthorizationUrl(state: string): string {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CALENDAR_CLIENT_ID is not configured.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleCalendarOAuthRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: OAUTH_SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleAuthorizationCode(code: string): Promise<{
  refreshToken: string;
  accountEmail: string;
}> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth credentials are not configured.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleCalendarOAuthRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) throw new Error("Google rejected the Calendar authorization code.");
  const tokens = await tokenResponse.json() as { refresh_token?: string; access_token?: string };
  if (!tokens.refresh_token || !tokens.access_token) {
    throw new Error("Google did not return the required Calendar authorization tokens.");
  }
  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoResponse.ok) throw new Error("Google did not return the authorized account.");
  const userInfo = await userInfoResponse.json() as { email?: string };
  if (!userInfo.email) throw new Error("Google did not return the authorized account email.");
  return { refreshToken: tokens.refresh_token, accountEmail: userInfo.email.toLowerCase() };
}