import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  remediationPlansTable,
  remediationStepsTable,
  profilesTable,
  decisionRecordsTable,
  identityVerificationsTable,
  applicationsTable,
  speculativeApplicationsTable,
  documentsTable,
  candidateMatchScoresTable,
  rolesTable,
} from "@workspace/db";
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

  const chatApplications = await db
    .select({ id: applicationsTable.id, status: applicationsTable.status, companyName: applicationsTable.companyName })
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId))
    .orderBy(desc(applicationsTable.id))
    .limit(10);
  const chatSpecApps = await db
    .select({ id: speculativeApplicationsTable.id, status: speculativeApplicationsTable.status, companyName: speculativeApplicationsTable.companyName })
    .from(speculativeApplicationsTable)
    .where(eq(speculativeApplicationsTable.userId, userId))
    .orderBy(desc(speculativeApplicationsTable.id))
    .limit(10);

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

  const totalChatApps = chatApplications.length + chatSpecApps.length;
  const chatInterviews = chatApplications.filter(
    (a) => a.status === "interview" || a.status === "interview_invited",
  ).length;
  const chatOffers = chatApplications.filter((a) => a.status === "offer").length;
  const applicationContext =
    totalChatApps > 0
      ? `Applications submitted: ${totalChatApps} (${chatApplications.length} direct, ${chatSpecApps.length} speculative). Interviews: ${chatInterviews}. Offers: ${chatOffers}.${chatApplications.length > 0 ? ` Recent: ${chatApplications.slice(0, 3).map((a) => `${a.companyName ?? "unknown"} (${a.status})`).join(", ")}.` : ""}`
      : "No applications submitted yet.";

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

${applicationContext}

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

// ── AI Next Steps ─────────────────────────────────────────────────────────────

interface NextStep {
  priority: number;
  title: string;
  description: string;
  action: string;
  href: string;
  category: string;
}

router.get("/ai/next-steps", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
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

  const applications = await db
    .select({ id: applicationsTable.id, status: applicationsTable.status })
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId));

  const speculativeApps = await db
    .select({ id: speculativeApplicationsTable.id, status: speculativeApplicationsTable.status })
    .from(speculativeApplicationsTable)
    .where(eq(speculativeApplicationsTable.userId, userId));

  const docs = await db
    .select({ id: documentsTable.id, documentType: documentsTable.documentType })
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId));

  const topMatches = await db
    .select({
      roleTitle: rolesTable.title,
      employer: rolesTable.employer,
      score: candidateMatchScoresTable.score,
    })
    .from(candidateMatchScoresTable)
    .innerJoin(rolesTable, eq(candidateMatchScoresTable.roleId, rolesTable.id))
    .where(eq(candidateMatchScoresTable.userId, userId))
    .orderBy(desc(candidateMatchScoresTable.score))
    .limit(3);

  const interviewCount = applications.filter(
    (a) => a.status === "interview" || a.status === "interview_invited",
  ).length;
  const offerCount = applications.filter((a) => a.status === "offer").length;
  const totalApps = applications.length + speculativeApps.length;

  const profileContext = profile
    ? `Profession: ${profile.profession ?? "not set"}, Specialty: ${profile.specialty ?? "not set"}, Registration: ${profile.registrationStatus ?? "not set"}, Experience: ${profile.experienceYears ?? 0} yrs, Sponsorship needed: ${profile.requiresSponsorship ? "yes" : "no"}, Qualification: ${profile.qualificationType ?? "unknown"} (${profile.qualificationCountry ?? "international"} ${profile.qualificationYear ?? ""}), Profile completion: ${(profile as { completionPct?: number }).completionPct ?? "unknown"}%`
    : "No profile set up yet.";

  const appContext = `Total applications: ${totalApps} (${applications.length} direct + ${speculativeApps.length} speculative). Interviews: ${interviewCount}. Offers: ${offerCount}.`;
  const eligibilityContext = latestDecision
    ? `Eligibility: ${latestDecision.outcome} — ${latestDecision.explanationText?.slice(0, 200) ?? ""}`
    : "Eligibility check not yet run.";
  const identityContext = `Identity verification: ${identityRecord?.status ?? "not submitted"}`;

  const hasCv = docs.some((d) => d.documentType === "cv");
  const docsContext = `Documents uploaded: ${docs.length} total.${hasCv ? " Has a CV uploaded." : " No CV uploaded yet."}`;

  const matchContext =
    topMatches.length > 0
      ? `Top role matches: ${topMatches.map((m) => `${m.roleTitle} at ${m.employer} (${m.score}% match)`).join(", ")}.`
      : "No match scores computed yet.";

  const systemPrompt = `You are an expert advisor for international healthcare professionals seeking to work in the UK.
Generate 3 to 5 ranked next-step recommendations for this candidate.
Return ONLY valid JSON — no markdown, no extra text:
{
  "steps": [
    {
      "priority": 1,
      "title": "<short action title, max 55 chars>",
      "description": "<1-2 sentences, specific and actionable, max 140 chars>",
      "action": "<button label, max 18 chars>",
      "href": "<must be exactly one of: /opportunities, /applications, /profile, /eligibility, /documents, /path, /sponsor-licences, /interview-prep>",
      "category": "<one of: apply, profile, document, eligibility, interview, followup>"
    }
  ]
}

Rules:
- Priority 1 = most urgent or highest impact for this specific candidate.
- Be concrete and tailored — mention their profession, registration status, or application count when relevant.
- Do not suggest steps already completed (e.g. don't suggest profile setup if profile is complete).
- Always include at least one application-related step if they have no applications yet.
- Prefer /eligibility if not assessed, /profile if incomplete, /documents if no CV uploaded.`;

  const userContext = `${profileContext}\n${appContext}\n${eligibilityContext}\n${identityContext}\n${docsContext}\n${matchContext}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContext },
      ],
      response_format: { type: "json_object" },
    });

    let parsed: { steps?: NextStep[] } = {};
    try {
      parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as { steps?: NextStep[] };
    } catch {
      parsed = {};
    }

    const steps: NextStep[] = (parsed.steps ?? [])
      .filter((s) => s && typeof s.priority === "number" && typeof s.title === "string")
      .slice(0, 5);

    res.json({ steps, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[ai/next-steps] error:", err);
    res.status(500).json({ error: "AI service unavailable. Please try again later." });
  }
});

export default router;
