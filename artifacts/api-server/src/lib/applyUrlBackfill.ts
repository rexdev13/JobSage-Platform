import { db } from "@workspace/db";
import { rolesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { eq, isNull, and } from "drizzle-orm";
import { writeAuditEvent } from "./audit";

export const APPLY_URL_BACKFILL_ACTION = "apply_url_backfill";

import { BLOCKED_VACANCY_DOMAINS } from "./vacancyUrlPolicy";

// Shared aggregator blocklist — single source of truth in vacancyUrlPolicy.
export const BLOCKED_APPLY_DOMAINS = BLOCKED_VACANCY_DOMAINS;

export interface BackfillRunSummary {
  found: number;
  skipped: number;
  failed: number;
  total: number;
  ranAt: string;
  triggeredBy: "scheduler" | "manual";
  durationMs: number;
}

let _lastRunSummary: BackfillRunSummary | null = null;

export function getLastBackfillSummary(): BackfillRunSummary | null {
  return _lastRunSummary;
}

/**
 * Validate that a URL is usable as an apply URL:
 * - Must parse as http or https
 * - Must not be a blocked aggregator domain
 * - Must not look like a search results page (contains query params such as ?q= or ?keywords=)
 */
export function isValidApplyUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isBlocked = BLOCKED_APPLY_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (isBlocked) return false;

  // Reject obvious search-results pages
  const searchParams = parsed.searchParams;
  const searchIndicators = ["q", "query", "keywords", "search", "s"];
  if (searchIndicators.some((p) => searchParams.has(p))) return false;

  return true;
}

/**
 * Use AI web search to find the direct job posting URL for a role on the employer's own website.
 * Returns a URL string if one is found and valid, or null otherwise.
 */
async function findApplyUrlWithAI(
  roleTitle: string,
  employer: string,
  location: string,
): Promise<string | null> {
  const prompt = `Find the direct apply URL for this specific job posting on the employer's own website:
- Job title: "${roleTitle}"
- Employer: "${employer}"
- Location: "${location}", United Kingdom

Search for this exact role on the employer's own careers website or NHS Jobs (jobs.nhs.uk). 
Do NOT return URLs from Indeed, LinkedIn, Reed, CV-Library, Glassdoor, TotalJobs, or any other job board aggregator.
The URL must be a direct link to the specific job posting, not a search results page.

Reply with ONLY a JSON object — no markdown, no explanation, just raw JSON:
{
  "found": true or false,
  "url": "https://... direct URL to job posting or null",
  "reason": "brief reason if not found"
}`;

  const response = await openai.responses.create({
    model: "gpt-4o",
    tools: [{ type: "web_search_preview" as const }],
    input: prompt,
  });

  const text = response.output_text ?? "";

  // Extract JSON from response — return null (skip) if AI gave no usable answer
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: { found?: boolean; url?: string | null; reason?: string };
  try {
    parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
  } catch {
    return null;
  }

  if (!parsed.found || typeof parsed.url !== "string") return null;

  const url = parsed.url.trim();
  if (!isValidApplyUrl(url)) return null;

  return url;
}

export interface BackfillOptions {
  batchSize?: number;
  triggeredBy?: "scheduler" | "manual";
  /** Delay between AI calls in ms to avoid rate limiting */
  rateDelayMs?: number;
}

/**
 * Run a batch of AI-assisted apply URL backfills for active roles that have no apply URL.
 * Each discovered URL is saved immediately and logged to the audit trail.
 * Roles that cannot be resolved are also logged with a skip reason.
 */
export async function runApplyUrlBackfill(
  options: BackfillOptions = {},
): Promise<BackfillRunSummary> {
  const {
    batchSize = 20,
    triggeredBy = "scheduler",
    rateDelayMs = 1500,
  } = options;

  const startMs = Date.now();
  let found = 0;
  let skipped = 0;
  let failed = 0;

  // Select active roles with no apply URL
  const roles = await db
    .select({
      id: rolesTable.id,
      title: rolesTable.title,
      employer: rolesTable.employer,
      location: rolesTable.location,
    })
    .from(rolesTable)
    .where(and(eq(rolesTable.active, true), isNull(rolesTable.applyUrl)))
    .limit(batchSize);

  console.log(
    `[apply-url-backfill] Starting — ${roles.length} roles to process (triggered by: ${triggeredBy})`,
  );

  for (const role of roles) {
    try {
      const url = await findApplyUrlWithAI(role.title, role.employer, role.location);

      if (url) {
        // Save to DB
        await db
          .update(rolesTable)
          .set({ applyUrl: url })
          .where(eq(rolesTable.id, role.id));

        // Audit log — URL was found and saved
        await writeAuditEvent(
          "system:backfill",
          APPLY_URL_BACKFILL_ACTION,
          `role:${role.id}`,
          {
            roleId: role.id,
            roleTitle: role.title,
            employer: role.employer,
            location: role.location,
            applyUrl: url,
            outcome: "url_set",
            triggeredBy,
          },
        );

        found++;
        console.log(
          `[apply-url-backfill] ✓ role ${role.id} "${role.title}" — set ${url}`,
        );
      } else {
        // Audit log — no valid URL found
        await writeAuditEvent(
          "system:backfill",
          APPLY_URL_BACKFILL_ACTION,
          `role:${role.id}`,
          {
            roleId: role.id,
            roleTitle: role.title,
            employer: role.employer,
            location: role.location,
            applyUrl: null,
            outcome: "skipped_no_url_found",
            triggeredBy,
          },
        );

        skipped++;
        console.log(
          `[apply-url-backfill] – role ${role.id} "${role.title}" — no valid URL found, skipped`,
        );
      }
    } catch (err) {
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[apply-url-backfill] ✗ role ${role.id} "${role.title}" — error: ${errorMsg}`,
      );

      // Audit log — processing failed
      await writeAuditEvent(
        "system:backfill",
        APPLY_URL_BACKFILL_ACTION,
        `role:${role.id}`,
        {
          roleId: role.id,
          roleTitle: role.title,
          employer: role.employer,
          location: role.location,
          applyUrl: null,
          outcome: "failed",
          error: errorMsg.slice(0, 500),
          triggeredBy,
        },
      );
    }

    // Rate limit between AI calls
    if (rateDelayMs > 0 && roles.indexOf(role) < roles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, rateDelayMs));
    }
  }

  const durationMs = Date.now() - startMs;
  const summary: BackfillRunSummary = {
    found,
    skipped,
    failed,
    total: roles.length,
    ranAt: new Date().toISOString(),
    triggeredBy,
    durationMs,
  };

  _lastRunSummary = summary;

  console.log(
    `[apply-url-backfill] Complete — found: ${found}, skipped: ${skipped}, failed: ${failed}, ${durationMs}ms`,
  );

  return summary;
}
