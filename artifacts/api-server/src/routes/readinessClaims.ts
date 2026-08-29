import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, candidateReadinessClaimsTable } from "@workspace/db";
import { requireAuthenticated } from "../middlewares/requireRole";
import {
  getCandidateReadinessClaim,
  getCandidateReadinessClaims,
  getStructuredGapCategory,
  normalizeReadinessClaim,
} from "../lib/readinessClaims";

const router: IRouter = Router();

const ReadinessClaimBody = z.object({
  claimText: z.string().trim().min(1, "A readiness claim is required.").max(240, "A readiness claim is too long."),
  sourceRoleId: z.number().int().positive().optional(),
  sourceVacancyId: z.number().int().positive().optional(),
}).strict();

function isCandidate(req: Request): boolean {
  return req.user?.role === "candidate";
}

function serializeClaim(claim: {
  id: number;
  claimKey: string;
  claimText: string;
  sourceRoleId: number | null;
  sourceVacancyId: number | null;
  createdAt: Date;
}) {
  return {
    id: claim.id,
    claimKey: claim.claimKey,
    claimText: claim.claimText,
    sourceRoleId: claim.sourceRoleId,
    sourceVacancyId: claim.sourceVacancyId,
    createdAt: claim.createdAt.toISOString(),
  };
}

router.get("/readiness/claims", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!isCandidate(req)) {
    res.status(403).json({ error: "Readiness claims are available to candidates only." });
    return;
  }

  try {
    const claims = await getCandidateReadinessClaims(req.user!.id);
    res.json({ claims: claims.map(serializeClaim) });
  } catch (err) {
    console.error("[readiness-claims] GET error:", err);
    res.status(500).json({ error: "Failed to fetch readiness claims." });
  }
});

router.post("/readiness/claims", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  if (!isCandidate(req)) {
    res.status(403).json({ error: "Readiness claims are available to candidates only." });
    return;
  }

  const parsed = ReadinessClaimBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const claimText = parsed.data.claimText;
  const claimKey = normalizeReadinessClaim(claimText);
  const structuredCategory = getStructuredGapCategory(claimText);
  if (!claimKey) {
    res.status(400).json({ error: "A readiness claim is required." });
    return;
  }
  if (structuredCategory) {
    res.status(422).json({
      error: `This gap concerns ${structuredCategory}, which must be updated on your profile instead of self-declared here.`,
      code: "STRUCTURED_PROFILE_FIELD",
      category: structuredCategory,
      profilePath: "/profile",
    });
    return;
  }

  try {
    const equivalentClaim = (await getCandidateReadinessClaims(req.user!.id))
      .find((claim) => normalizeReadinessClaim(claim.claimKey) === claimKey);
    if (equivalentClaim) {
      res.status(200).json({ claim: serializeClaim(equivalentClaim), created: false });
      return;
    }

    const [inserted] = await db
      .insert(candidateReadinessClaimsTable)
      .values({
        userId: req.user!.id,
        claimKey,
        claimText,
        sourceRoleId: parsed.data.sourceRoleId ?? null,
        sourceVacancyId: parsed.data.sourceVacancyId ?? null,
      })
      .onConflictDoNothing({
        target: [candidateReadinessClaimsTable.userId, candidateReadinessClaimsTable.claimKey],
      })
      .returning();

    const claim = inserted ?? await getCandidateReadinessClaim(req.user!.id, claimKey);
    if (!claim) {
      res.status(500).json({ error: "Failed to save readiness claim." });
      return;
    }
    res.status(inserted ? 201 : 200).json({ claim: serializeClaim(claim), created: !!inserted });
  } catch (err) {
    console.error("[readiness-claims] POST error:", err);
    res.status(500).json({ error: "Failed to save readiness claim." });
  }
});

export default router;