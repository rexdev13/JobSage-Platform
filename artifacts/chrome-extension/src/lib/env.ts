/**
 * Environment (Prod/Dev) configuration shared by the background service
 * worker and the popup UI. Stored in chrome.storage.sync so a toggle in the
 * popup takes effect instantly, no reinstall.
 */
export type ExtensionEnv = "production" | "development";

export const PROD_ORIGIN = "https://jobsage.co.uk";

// Prefilled at build time by Vite (see vite.config.ts define).
declare const __DEV_ORIGIN__: string;
export const DEFAULT_DEV_ORIGIN: string =
  typeof __DEV_ORIGIN__ !== "undefined" ? __DEV_ORIGIN__ : "";

export interface EnvSettings {
  env: ExtensionEnv;
  devOrigin: string;
}

export function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function getEnvSettings(): Promise<EnvSettings> {
  const stored = await chrome.storage.sync.get({
    env: "production",
    devOrigin: DEFAULT_DEV_ORIGIN,
  });
  const env: ExtensionEnv = stored["env"] === "development" ? "development" : "production";
  const devOrigin = normalizeOrigin(String(stored["devOrigin"] ?? "")) || DEFAULT_DEV_ORIGIN;
  return { env, devOrigin };
}

export async function saveEnvSettings(settings: Partial<EnvSettings>): Promise<void> {
  const patch: Record<string, string> = {};
  if (settings.env) patch["env"] = settings.env;
  if (settings.devOrigin !== undefined) patch["devOrigin"] = normalizeOrigin(settings.devOrigin);
  await chrome.storage.sync.set(patch);
}

/** Origin used for both the API base and the session-cookie lookup. */
export function activeOrigin(settings: EnvSettings): string {
  return settings.env === "development" && settings.devOrigin ? settings.devOrigin : PROD_ORIGIN;
}

export function apiBase(settings: EnvSettings): string {
  return `${activeOrigin(settings)}/api`;
}
