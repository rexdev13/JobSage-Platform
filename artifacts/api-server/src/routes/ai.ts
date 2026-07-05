import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { remediationPlansTable, remediationStepsTable, profilesTable, decisionRecordsTable, identityVerificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { prioritiseRemediationSteps } from "../lib/aiPrioritiser";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const DISCLAIMER =
  "This platform provides decision support only. Final decisions rest with the relevant regulator. AI-generated suggestions should be reviewed alongside professional advice.";

router.get("/ai/remediation-suggestions/:planId", requireAuthenticated, async (req, res): Promise<void> => {
  const planId = parseInt(req.params.planId as string, 10);
  if (isNaN(planId)) {
    res.status(400).json({ error: "Invalid planId." });
    return;
  }

  const [plan] = await db
    .select()
    .from(remediationPlansTable)
    .where(
      and(
        eq(remediationPlansTable.id, planId),
        eq(remediationPlansTable.userId, req.user!.id)
      )
    )
    .limit(1);

  if (!plan) {
    res.status(404).json({ error: "Remediation plan not found." });
    return;
  }

  const steps = await db
    .select()
    .from(remediationStepsTable)
    .where(eq(remediationStepsTable.planId, plan.id))
    .orderBy(remediationStepsTable.stepOrder);

  if (steps.length === 0) {
    res.json({
      planId: plan.id,
      suggestions: [],
      overallRationale: "No steps found in this plan.",
      disclaimer: DISCLAIMER,
    });
    return;
  }

  try {
    const result = await prioritiseRemediationSteps(plan.id, steps);
    res.json({
      planId: plan.id,
      suggestions: result.suggestions,
      overallRationale: result.overallRationale,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    console.error("AI suggestion error:", err);
    res.status(500).json({ error: "AI service unavailable. Please try again later." });
  }
});

// ── AI Chat (SSE streaming) ───────────────────────────────────────────────────

router.post("/ai/chat", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { message, history } = req.body as {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required." });
    return;
  }

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  const [latestDecision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);
  const [identityRecord] = await db
    .select({ status: identityVerificationsTable.status })
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.userId, userId))
    .limit(1);

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || user.email || "Candidate";

  const profileContext = profile
    ? `Candidate profile:
- Name: ${candidateName}
- Profession: ${profile.profession?.replace(/_/g, " ") ?? "not set"}
- Specialty: ${profile.specialty ?? "not set"}
- Qualification type: ${profile.qualificationType ?? "not set"} (${profile.qualificationCountry ?? "international"}, ${profile.qualificationYear ?? "year unknown"})
- Experience: ${profile.experienceYears} years
- Registration status: ${profile.registrationStatus?.replace(/_/g, " ") ?? "not set"}
- Requires UK sponsorship: ${profile.requiresSponsorship ? "yes" : "no"}
- Preferred region: ${profile.preferredRegion ?? "not set"}`
    : "Candidate has not yet completed their profile.";

  const eligibilityContext = latestDecision
    ? `Latest eligibility assessment:
- Outcome: ${latestDecision.outcome}
- Explanation: ${latestDecision.explanationText}
- Review flagged: ${latestDecision.reviewFlagged ? "yes — queued for human review" : "no"}`
    : "No eligibility assessment has been run yet.";

  const identityContext = identityRecord
    ? `Identity verification status: ${identityRecord.status}`
    : "Identity verification: not submitted.";

  const systemPrompt = `You are SAGE, an expert AI assistant for international healthcare professionals seeking to work in the UK. You are integrated into JOBSAGE, a decision-intelligence platform that helps candidates navigate the UK registration and job search process.

Your role is to:
- Answer questions about UK healthcare registration (GMC, NMC, HCPC), visa sponsorship, NHS jobs, and the candidate's specific situation
- Give practical, actionable advice tailored to this candidate's profile
- Be concise, warm, and professional — you're a trusted career advisor
- Flag when the candidate should seek professional legal or medical regulatory advice
- Never provide definitive legal or immigration advice (always add appropriate caveats)

Current candidate context:
${profileContext}

${eligibilityContext}

${identityContext}

Platform context: JOBSAGE guides candidates through 10 stages: Profile → Verification → Eligibility → Matching → Applications → Interviews → Offer → Visa → Relocation → Success.

Always respond in clear, plain English. Be concise — aim for 2-4 short paragraphs. If the candidate asks something highly specific that requires professional advice, say so clearly.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...((history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content }))),
      { role: "user", content: message.trim() },
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 600,
      stream: true,
      messages,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, disclaimer: DISCLAIMER })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[ai/chat] error:", err);
    res.write(`data: ${JSON.stringify({ error: "AI service unavailable. Please try again." })}\n\n`);
    res.end();
  }
});

export default router;
