import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import {
  auditEventsTable,
  db,
  sponsorLicenceCompanySiteChecksTable,
  sponsorLicenceIdentityCrosswalkTable,
  sponsorLicencesTable,
} from "@workspace/db";
import {
  ApplySponsorWebsiteImportResponse,
  PreviewSponsorWebsiteImportResponse,
  ResolveSponsorWebsiteIdentityBody,
  ResolveSponsorWebsiteIdentityResponse,
} from "@workspace/api-zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import {
  identitySnapshot,
  resolveSponsorIdentity,
  sponsorIdentityKey,
  SPONSOR_IDENTITY_SOURCE,
  type SponsorIdentity,
  type SponsorIdentityTarget,
} from "../lib/sponsorWebsiteCrossEnvIdentity";
import {
  buildSponsorWebsiteImportPlan,
  type SponsorWebsiteImportCandidate,
  type SponsorWebsiteProductionTarget,
} from "../lib/sponsorWebsiteImportPlan";

const router: IRouter = Router();
const MAX_IMPORT_ROWS = 20_000;
const MAX_REVIEW_ROWS = 6_500;
const REQUIRED_COLUMNS = [
  "source_ref",
  "field",
  "confidence",
  "development_confidence",
  "organisation_name",
  "town_city",
  "county",
  "region",
  "industry",
  "route",
  "sub_route",
  "candidate_url",
  "evidence_url",
  "development_current_value",
  "development_action",
  "verification_status",
] as const;

type ImportedRecord = Record<string, string>;
type FullPlan = ReturnType<typeof buildSponsorWebsiteImportPlan>;

class ImportConflictError extends Error {
  readonly statusCode = 409;
}

class CsvImportValidationError extends Error {}

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

function parseCandidateFile(buffer: Buffer): {
  candidates: SponsorWebsiteImportCandidate[];
  inputHash: string;
} {
  let records: ImportedRecord[];
  try {
    records = parse(buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as ImportedRecord[];
  } catch {
    throw new CsvImportValidationError("Invalid CSV. Upload a valid UTF-8 CSV with a header row.");
  }
  if (records.length === 0 || records.length > MAX_IMPORT_ROWS) {
    throw new CsvImportValidationError(`CSV must contain 1–${MAX_IMPORT_ROWS.toLocaleString()} rows.`);
  }
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in records[0]!));
  if (missingColumns.length) {
    throw new CsvImportValidationError(`CSV is missing required columns: ${missingColumns.join(", ")}.`);
  }

  const seenSourceRefs = new Set<string>();
  const candidates = records.map((record, index) => {
    const sourceRef = record.source_ref?.trim();
    if (!sourceRef) throw new CsvImportValidationError(`CSV row ${index + 2}: source_ref is required.`);
    if (seenSourceRefs.has(sourceRef)) {
      throw new CsvImportValidationError(`CSV row ${index + 2}: duplicate source_ref ${sourceRef}.`);
    }
    seenSourceRefs.add(sourceRef);

    const field = record.field?.trim().toLowerCase();
    if (field !== "website" && field !== "careers") {
      throw new CsvImportValidationError(`CSV row ${index + 2}: field must be website or careers.`);
    }
    return {
      sourceRef,
      field,
      confidence: record.confidence?.trim().toLowerCase() ?? "",
      developmentConfidence: record.development_confidence?.trim().toLowerCase() ?? "",
      organisationName: record.organisation_name?.trim() ?? "",
      townCity: record.town_city?.trim() ?? "",
      county: record.county?.trim() ?? "",
      region: record.region?.trim() ?? "",
      industry: record.industry?.trim() ?? "",
      route: record.route?.trim() ?? "",
      subRoute: record.sub_route?.trim() ?? "",
      candidateUrl: record.candidate_url?.trim() ?? "",
      evidenceUrl: record.evidence_url?.trim() ?? "",
      developmentCurrentValue: record.development_current_value?.trim() ?? "",
      developmentAction: record.development_action?.trim().toLowerCase() ?? "",
      verificationStatus: record.verification_status?.trim().toLowerCase() ?? "",
    } satisfies SponsorWebsiteImportCandidate;
  });

  return {
    candidates,
    inputHash: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function makeCurrentPlan(buffer: Buffer): Promise<FullPlan> {
  const parsed = parseCandidateFile(buffer);
  const [sponsors, careersTargets, mappings] = await Promise.all([
    db.select({
      id: sponsorLicencesTable.id,
      organisationName: sponsorLicencesTable.organisationName,
      townCity: sponsorLicencesTable.townCity,
      county: sponsorLicencesTable.county,
      region: sponsorLicencesTable.region,
      industry: sponsorLicencesTable.industry,
      route: sponsorLicencesTable.route,
      subRoute: sponsorLicencesTable.subRoute,
      website: sponsorLicencesTable.website,
    }).from(sponsorLicencesTable),
    db.select({
      id: sponsorLicenceCompanySiteChecksTable.id,
      organisationName: sponsorLicenceCompanySiteChecksTable.organisationName,
      careersUrl: sponsorLicenceCompanySiteChecksTable.careersUrl,
    }).from(sponsorLicenceCompanySiteChecksTable),
    db.select({
      identityKey: sponsorLicenceIdentityCrosswalkTable.identityKey,
      targetSponsorLicenceId: sponsorLicenceIdentityCrosswalkTable.targetSponsorLicenceId,
      resolutionMethod: sponsorLicenceIdentityCrosswalkTable.resolutionMethod,
    })
      .from(sponsorLicenceIdentityCrosswalkTable)
      .where(eq(sponsorLicenceIdentityCrosswalkTable.sourceSystem, SPONSOR_IDENTITY_SOURCE)),
  ]);

  return buildSponsorWebsiteImportPlan({
    candidates: parsed.candidates,
    sponsors: sponsors.map((sponsor) => ({
      ...sponsor,
      townCity: sponsor.townCity ?? "",
      county: sponsor.county ?? "",
      region: sponsor.region ?? "",
      industry: sponsor.industry ?? "",
      route: sponsor.route ?? "",
      subRoute: sponsor.subRoute ?? "",
    })) as SponsorWebsiteProductionTarget[],
    careersTargets,
    mappings,
    inputHash: parsed.inputHash,
  });
}

function uploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  uploadCsv.single("file")(req, res, (error: unknown) => {
    if (error) {
      const message =
        error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
          ? "CSV must be no larger than 10 MB."
          : "Could not read the uploaded CSV.";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

function respondWithPlan(res: Response, plan: FullPlan): void {
  if (plan.rows.length > MAX_REVIEW_ROWS) {
    res.status(400).json({ error: `This importer supports at most ${MAX_REVIEW_ROWS} rows per run.` });
    return;
  }
  res.json(PreviewSponsorWebsiteImportResponse.parse({
    environment: process.env.NODE_ENV ?? "unknown",
    rowCount: plan.rows.length,
    planHash: plan.planHash,
    counts: plan.counts,
    writeCount: plan.writes.length,
    rows: plan.rows,
  }));
}

router.post(
  "/admin/sponsor-website-import/preview",
  requireRole("super_admin"),
  uploadMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "CSV file is required." });
      return;
    }
    try {
      respondWithPlan(res, await makeCurrentPlan(req.file.buffer));
    } catch (error) {
      if (error instanceof CsvImportValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/admin/sponsor-website-import/resolve",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const body = ResolveSponsorWebsiteIdentityBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { identity: normalizedIdentity, reason } = body.data;
    const targetId = body.data.targetSponsorLicenceId;

    try {
      const [target] = await db.select({
        id: sponsorLicencesTable.id,
        organisationName: sponsorLicencesTable.organisationName,
        townCity: sponsorLicencesTable.townCity,
        county: sponsorLicencesTable.county,
        region: sponsorLicencesTable.region,
        industry: sponsorLicencesTable.industry,
        route: sponsorLicencesTable.route,
        subRoute: sponsorLicencesTable.subRoute,
      }).from(sponsorLicencesTable).where(eq(sponsorLicencesTable.id, targetId)).limit(1);
      if (!target) {
        res.status(404).json({ error: "Production sponsor target was not found." });
        return;
      }

      const targetIdentity: SponsorIdentityTarget = {
        ...target,
        townCity: target.townCity ?? "",
        county: target.county ?? "",
        region: target.region ?? "",
        industry: target.industry ?? "",
        route: target.route ?? "",
        subRoute: target.subRoute ?? "",
      };
      const validation = resolveSponsorIdentity(
        normalizedIdentity,
        [targetIdentity],
        targetId,
      );
      if (validation.status !== "manual_mapping") {
        res.status(409).json({
          error: "The selected production row conflicts with the supplied identity fields.",
        });
        return;
      }

      const key = sponsorIdentityKey(normalizedIdentity);
      await db.transaction(async (tx) => {
        await tx.insert(sponsorLicenceIdentityCrosswalkTable)
          .values({
            sourceSystem: SPONSOR_IDENTITY_SOURCE,
            identityKey: key,
            identitySnapshot: identitySnapshot(normalizedIdentity),
            targetSponsorLicenceId: targetId,
            resolutionMethod: "manual_review",
            resolvedBy: req.user!.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              sponsorLicenceIdentityCrosswalkTable.sourceSystem,
              sponsorLicenceIdentityCrosswalkTable.identityKey,
            ],
            set: {
              identitySnapshot: identitySnapshot(normalizedIdentity),
              targetSponsorLicenceId: targetId,
              resolutionMethod: "manual_review",
              resolvedBy: req.user!.id,
              updatedAt: new Date(),
            },
          });
        await tx.insert(auditEventsTable).values({
          actor: req.user!.id,
          action: "sponsor_website_identity_resolved",
          target: `identity:${key}`,
          details: {
            targetSponsorLicenceId: targetId,
            organisationName: normalizedIdentity.organisationName,
            reason,
          },
        });
      });
      res.json(ResolveSponsorWebsiteIdentityResponse.parse({
        saved: true,
        identityKey: key,
        targetSponsorLicenceId: targetId,
      }));
    } catch (error) {
      throw error;
    }
  },
);

router.post(
  "/admin/sponsor-website-import/apply",
  requireRole("super_admin"),
  uploadMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "CSV file is required." });
      return;
    }
    if (process.env.NODE_ENV !== "production" ||
        (!process.env.REPLIT_DEPLOYMENT && !process.env.REPLIT_DEPLOYMENT_ID)) {
      res.status(409).json({
        error: "Applying imports is available only from the published production application.",
      });
      return;
    }
    const expectedPlanHash = String(req.body?.planHash ?? "");
    if (!/^[a-f0-9]{64}$/.test(expectedPlanHash)) {
      res.status(400).json({ error: "A reviewed preview plan hash is required." });
      return;
    }

    try {
      const plan = await makeCurrentPlan(req.file.buffer);
      if (plan.planHash !== expectedPlanHash) {
        res.status(409).json({
          error: "Production data or the uploaded CSV changed after preview. Run a new preview.",
          currentPlanHash: plan.planHash,
          counts: plan.counts,
        });
        return;
      }

      const applied = await db.transaction(async (tx) => {
        const sponsorIds = [...new Set(
          plan.writes
            .filter((write) => write.field === "website")
            .map((write) => write.targetSponsorLicenceId),
        )];
        const siteIds = [...new Set(
          plan.writes
            .filter((write) => write.field === "careers" && write.targetCompanySiteCheckId != null)
            .map((write) => write.targetCompanySiteCheckId!),
        )];
        const [lockedSponsors, lockedSites] = await Promise.all([
          sponsorIds.length
            ? tx.select({
                id: sponsorLicencesTable.id,
                organisationName: sponsorLicencesTable.organisationName,
                townCity: sponsorLicencesTable.townCity,
                county: sponsorLicencesTable.county,
                region: sponsorLicencesTable.region,
                industry: sponsorLicencesTable.industry,
                route: sponsorLicencesTable.route,
                subRoute: sponsorLicencesTable.subRoute,
                website: sponsorLicencesTable.website,
              }).from(sponsorLicencesTable)
                .where(inArray(sponsorLicencesTable.id, sponsorIds))
                .for("update")
            : Promise.resolve([]),
          siteIds.length
            ? tx.select({
                id: sponsorLicenceCompanySiteChecksTable.id,
                organisationName: sponsorLicenceCompanySiteChecksTable.organisationName,
                careersUrl: sponsorLicenceCompanySiteChecksTable.careersUrl,
              }).from(sponsorLicenceCompanySiteChecksTable)
                .where(inArray(sponsorLicenceCompanySiteChecksTable.id, siteIds))
                .for("update")
            : Promise.resolve([]),
        ]);
        const sponsorsById = new Map(lockedSponsors.map((row) => [row.id, row]));
        const sitesById = new Map(lockedSites.map((row) => [row.id, row]));

        for (const write of plan.writes) {
          const current =
            write.field === "website"
              ? sponsorsById.get(write.targetSponsorLicenceId)?.website ?? ""
              : sitesById.get(write.targetCompanySiteCheckId ?? -1)?.careersUrl ?? "";
          if (current.trim() || current !== write.currentValue) {
            throw new ImportConflictError(
              `A target changed after preview (${write.sourceRef}); run a new preview.`,
            );
          }
          const target = sponsorsById.get(write.targetSponsorLicenceId);
          if (!target) {
            throw new ImportConflictError("A production sponsor changed after preview.");
          }
          const targetIdentity: SponsorIdentityTarget = {
            id: target.id,
            organisationName: target.organisationName,
            townCity: target.townCity ?? "",
            county: target.county ?? "",
            region: target.region ?? "",
            industry: target.industry ?? "",
            route: target.route ?? "",
            subRoute: target.subRoute ?? "",
          };
          if (
            resolveSponsorIdentity(write.identity, [targetIdentity], target.id).status !==
            "manual_mapping"
          ) {
            throw new ImportConflictError("A sponsor identity changed after preview.");
          }
          if (write.field === "careers") {
            const site = sitesById.get(write.targetCompanySiteCheckId ?? -1);
            if (
              !site ||
              site.organisationName.trim().toLocaleLowerCase("en-GB") !==
                target.organisationName.trim().toLocaleLowerCase("en-GB")
            ) {
              throw new ImportConflictError("A careers-site identity changed after preview.");
            }
          }
        }

        let websiteUpdates = 0;
        let careersUpdates = 0;
        for (const write of plan.writes) {
          if (write.field === "website") {
            const target = sponsorsById.get(write.targetSponsorLicenceId);
            if (!target) throw new ImportConflictError("A sponsor target disappeared after preview.");
            const updated = await tx.update(sponsorLicencesTable)
              .set({ website: write.url })
              .where(and(
                eq(sponsorLicencesTable.id, write.targetSponsorLicenceId),
                eq(sponsorLicencesTable.organisationName, target.organisationName),
                sql`(${sponsorLicencesTable.website} IS NULL OR btrim(${sponsorLicencesTable.website}) = '')`,
              ))
              .returning({ id: sponsorLicencesTable.id });
            if (updated.length !== 1) {
              throw new ImportConflictError("A sponsor website changed during import.");
            }
            websiteUpdates += 1;
          } else {
            const siteId = write.targetCompanySiteCheckId;
            if (siteId == null) throw new ImportConflictError("A careers target is missing.");
            const updated = await tx.update(sponsorLicenceCompanySiteChecksTable)
              .set({ careersUrl: write.url, updatedAt: new Date() })
              .where(and(
                eq(sponsorLicenceCompanySiteChecksTable.id, siteId),
                sql`(${sponsorLicenceCompanySiteChecksTable.careersUrl} IS NULL OR btrim(${sponsorLicenceCompanySiteChecksTable.careersUrl}) = '')`,
              ))
              .returning({ id: sponsorLicenceCompanySiteChecksTable.id });
            if (updated.length !== 1) {
              throw new ImportConflictError("A careers URL changed during import.");
            }
            careersUpdates += 1;
          }
        }

        const mappings = plan.exactMappings.map((mapping) => ({
          sourceSystem: SPONSOR_IDENTITY_SOURCE,
          identityKey: mapping.identityKey,
          identitySnapshot: mapping.identitySnapshot,
          targetSponsorLicenceId: mapping.targetSponsorLicenceId,
          resolutionMethod: "exact_unique" as const,
          updatedAt: new Date(),
        }));
        let mappingsStored = 0;
        for (let offset = 0; offset < mappings.length; offset += 250) {
          const inserted = await tx.insert(sponsorLicenceIdentityCrosswalkTable)
            .values(mappings.slice(offset, offset + 250))
            .onConflictDoNothing({
              target: [
                sponsorLicenceIdentityCrosswalkTable.sourceSystem,
                sponsorLicenceIdentityCrosswalkTable.identityKey,
              ],
            })
            .returning({ id: sponsorLicenceIdentityCrosswalkTable.id });
          mappingsStored += inserted.length;
        }
        await tx.insert(auditEventsTable).values({
          actor: req.user!.id,
          action: "sponsor_website_import_applied",
          target: `plan:${plan.planHash}`,
          details: {
            rowCount: plan.rows.length,
            websiteUpdates,
            careersUpdates,
            mappingsStored,
            counts: plan.counts,
          },
        });
        return { websiteUpdates, careersUpdates, mappingsStored };
      });

      res.json(ApplySponsorWebsiteImportResponse.parse({
        applied: true,
        planHash: plan.planHash,
        ...applied,
        counts: plan.counts,
      }));
    } catch (error) {
      const status = error instanceof ImportConflictError
        ? 409
        : error instanceof CsvImportValidationError
          ? 400
          : 500;
      if (status === 500) {
        throw error;
      }
      res.status(status).json({
        error:
          error instanceof ImportConflictError || error instanceof CsvImportValidationError
            ? error.message
            : "Could not apply import.",
      });
    }
  },
);

export default router;