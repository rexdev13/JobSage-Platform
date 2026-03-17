import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { remediationPlansTable, remediationStepsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const DISCLAIMER =
  "This platform provides decision support only. Final decisions rest with the relevant regulator. AI-generated suggestions should be reviewed alongside professional advice.";

router.get("/ai/remediation-suggestions/:planId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

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

  const stepsText = steps
    .map(
      (s) =>
        `- Step ID ${s.id}: "${s.title}" (gap: ${s.gap}, source: ${s.stepSource}${s.timelineRange ? `, timeline: ${s.timelineRange}` : ""})`
    )
    .join("\n");

  const systemPrompt = `You are a clinical career advisor specialising in UK healthcare regulation and visa sponsorship. 
Your task is to suggest an optimal ordering for remediation steps that a healthcare professional must complete to achieve UK regulatory registration.
Consider: urgency of gaps, dependency between steps, typical timelines, and whether sponsorship steps should be addressed early.
Provide practical, evidence-based reasoning for each ordering decision.
Respond ONLY with valid JSON matching this shape exactly:
{
  "suggestions": [
    { "stepId": <number>, "suggestedOrder": <number starting from 1>, "rationale": "<string>" }
  ],
  "overallRationale": "<string>"
}`;

  const userPrompt = `Here are the current remediation steps for plan ${plan.id}:
${stepsText}

Please suggest the best order to tackle these steps. Return a JSON object as described.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let parsed: { suggestions?: unknown[]; overallRationale?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { suggestions: [], overallRationale: "Could not parse AI response." };
    }

    res.json({
      planId: plan.id,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      overallRationale: parsed.overallRationale ?? "No overall rationale provided.",
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    console.error("AI suggestion error:", err);
    res.status(500).json({ error: "AI service unavailable. Please try again later." });
  }
});

export default router;
