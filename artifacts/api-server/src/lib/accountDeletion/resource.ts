import { z } from "zod/v4";

const cleanupResource = z.object({
  version: z.literal(1),
  accountId: z.string().min(1).max(150),
  reference: z.string().min(1).max(4096).optional(),
  provider: z.string().min(1).max(100).optional(),
}).strict();

export type CleanupResource = z.infer<typeof cleanupResource>;

/** One contract for queue preflight and execution. Never include invalid
 * payloads in errors: they may contain identities or credentials. */
export function parseCleanupResource(value: string): CleanupResource | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const parsed = cleanupResource.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
