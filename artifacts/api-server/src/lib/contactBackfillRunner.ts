/**
 * contactBackfillRunner.ts
 *
 * Runs contact extraction for sponsor licences that have no contact info yet.
 * These are sponsors whose vacancy checks all predate the contact-extraction
 * feature — the 24h cache would normally prevent re-running those checks, so
 * this runner bypasses the cache explicitly.
 *
 * Designed to be called once from the admin UI (POST /admin/super/contact-backfill)
 * and to run as a background job. Progress is tracked in the module-level `state`
 * object, polled via getContactBackfillStatus().
 */

import { db } from "@workspace/db";
import { sponsorLicencesTable } from "@workspace/db";
import { isNull, or, eq } from "drizzle-orm";
import { runVacancyCheck } from "./vacancyCheckHelper";

export interface ContactBackfillStatus {
  isRunning: boolean;
  total: number;
  processed: number;
  contactsFound: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  sampleResults: Array<{
    organisationName: string;
    website: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  }>;
}

function initialState(): ContactBackfillStatus {
  return {
    isRunning: false,
    total: 0,
    processed: 0,
    contactsFound: 0,
    errors: 0,
    startedAt: null,
    completedAt: null,
    lastError: null,
    sampleResults: [],
  };
}

let state: ContactBackfillStatus = initialState();

export function getContactBackfillStatus(): ContactBackfillStatus {
  return { ...state, sampleResults: [...state.sampleResults] };
}

const BACKFILL_CONCURRENCY = 5;

/**
 * Run a contact backfill pass over sponsors with no contact information.
 * Bypasses the normal 24h vacancy-check cache so that old checked sponsors
 * get a fresh AI call that includes contact extraction.
 *
 * @param limit Max number of sponsors to process in this run (default 200).
 */
export async function runContactBackfill(limit = 200): Promise<void> {
  if (state.isRunning) {
    throw new Error("A contact backfill is already running.");
  }

  state = { ...initialState(), isRunning: true, startedAt: new Date().toISOString() };

  try {
    // Select sponsors that have no contact info at all
    const orgs = await db
      .select({ organisationName: sponsorLicencesTable.organisationName })
      .from(sponsorLicencesTable)
      .where(
        or(
          isNull(sponsorLicencesTable.contactEmail),
          eq(sponsorLicencesTable.contactEmail, ""),
        ),
      )
      .limit(limit);

    // Further filter to those where website AND phone are also null
    // (already in the WHERE for email, but we only want those missing everything)
    const targets = await db
      .selectDistinct({ organisationName: sponsorLicencesTable.organisationName })
      .from(sponsorLicencesTable)
      .where(
        isNull(sponsorLicencesTable.contactEmail),
      )
      .limit(limit);

    state.total = targets.length;
    console.log(`[contact-backfill] Starting: ${targets.length} sponsors with no contact email`);

    let idx = 0;

    async function worker(): Promise<void> {
      while (idx < targets.length) {
        const myIdx = idx++;
        const org = targets[myIdx];
        if (!org) continue;

        try {
          const result = await runVacancyCheck(org.organisationName, { bypassCache: true });
          const gotContact = !!(result.discoveredContactEmail || result.discoveredContactPhone || result.discoveredWebsite);
          if (gotContact) {
            state.contactsFound++;
            // Keep up to 50 sample results for the report
            if (state.sampleResults.length < 50) {
              state.sampleResults.push({
                organisationName: org.organisationName,
                website: result.discoveredWebsite,
                contactEmail: result.discoveredContactEmail,
                contactPhone: result.discoveredContactPhone,
              });
            }
          }
        } catch (err) {
          state.errors++;
          state.lastError = err instanceof Error ? err.message : String(err);
          console.error(`[contact-backfill] Failed for "${org.organisationName}":`, state.lastError);
        }

        state.processed++;
        if (state.processed % 20 === 0) {
          console.log(
            `[contact-backfill] Progress: ${state.processed}/${state.total}, contacts found: ${state.contactsFound}`,
          );
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(BACKFILL_CONCURRENCY, targets.length || 1) }, () => worker()),
    );

    console.log(
      `[contact-backfill] Complete — processed: ${state.processed}, contacts found: ${state.contactsFound}, errors: ${state.errors}`,
    );
  } finally {
    state.isRunning = false;
    state.completedAt = new Date().toISOString();
  }
}

/**
 * Fire-and-forget entry point. Returns immediately; progress is polled via
 * getContactBackfillStatus().
 */
export function startContactBackfill(limit = 200): { started: boolean; reason?: string } {
  if (state.isRunning) return { started: false, reason: "Already running" };

  void runContactBackfill(limit).catch((err) => {
    console.error("[contact-backfill] Unhandled error:", err instanceof Error ? err.message : err);
  });

  return { started: true };
}
