export * from "./privacy";
export * from "./deletion-policy";
import { z } from "zod/v4";

export function safeInternalPath(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\r\n\0]/.test(value)
    || /%(?:0[ad]|5c)/i.test(value)) return null;
  try {
    const url = new URL(value, "https://internal.invalid");
    return url.origin === "https://internal.invalid" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch { return null; }
}

/** Accept public HTTP(S) employer links, but always return their HTTPS URL. */
export function safeEmployerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.port
      || !host.includes(".") || /[:\[\]]/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
      || host.endsWith(".localhost")) return null;
    url.protocol = "https:";
    return url.href;
  } catch { return null; }
}

const base = {
  version: z.literal(1),
  channel: z.string().min(20).max(100),
  url: z.string().max(4096),
  timestamp: z.number().int(),
};
export const workspaceMessage = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("ready") }).strict(),
  z.object({ ...base, type: z.literal("session"), code: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...base, type: z.literal("application"), applicationId: z.number().int().positive() }).strict(),
  z.object({ ...base, type: z.literal("logout") }).strict(),
  z.object({ ...base, type: z.literal("download"), downloadUrl: z.string().max(4096), filename: z.string().max(150) }).strict(),
  z.object({
    ...base,
    type: z.literal("privacy-export"),
    expectedAccountId: z.string().min(1).max(150),
    password: z.string().min(1).max(1024).optional(),
    emailCodeProof: z.string().min(40).max(128).optional(),
    confirmed: z.literal(true),
  }).strict(),
  z.object({ ...base, type: z.literal("open-url"), destination: z.string().max(4096) }).strict(),
]);
export type WorkspaceMessage = z.infer<typeof workspaceMessage>;
export { AI_REPORT_REASONS, buildAIReportMessage } from "./ai-report";
export type { AIReportReason } from "./ai-report";

export function validateWorkspaceMessage(raw: string, options: {
  origin: string; navigationUrl: string; channel: string; now?: number;
  /** Android WebView can retain the document-load URL after SPA navigation.
   * Opt in only for the first-party workspace; both origins remain mandatory. */
  allowSameOriginNavigation?: boolean;
}): WorkspaceMessage | null {
  if (raw.length > 12_000) return null;
  try {
    const message = workspaceMessage.parse(JSON.parse(raw));
    if (message.type === "privacy-export") {
      const hasPassword = typeof message.password === "string";
      const hasEmailCodeProof = typeof message.emailCodeProof === "string";
      if (hasPassword === hasEmailCodeProof) return null;
    }
    const now = options.now ?? Date.now();
    if (message.channel !== options.channel || Math.abs(now - message.timestamp) > 60_000
      || new URL(message.url).origin !== options.origin
      || new URL(options.navigationUrl).origin !== options.origin
      || (!options.allowSameOriginNavigation
        && new URL(message.url).href !== new URL(options.navigationUrl).href)) return null;
    return message;
  } catch { return null; }
}
