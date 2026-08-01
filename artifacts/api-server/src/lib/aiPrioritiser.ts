import { openai } from "@workspace/integrations-openai-ai-server";

export interface PrioritisableStep {
  id: number;
  title: string;
  gap: string;
  stepSource: string;
  timelineRange?: string | null;
  costRange?: string | null;
  pathway?: string | null;
  stepOrder: number;
}

export interface AiStepSuggestion {
  stepId: number;
  suggestedOrder: number;
  rationale: string;
}

export interface AiPrioritisationResult {
  suggestions: AiStepSuggestion[];
  overallRationale: string;
}

const SYSTEM_PROMPT = `You are a clinical career advisor specialising in UK healthcare regulation and visa sponsorship.
Your task is to suggest an optimal ordering for remediation steps a healthcare professional must complete to achieve UK regulatory registration.

Prioritisation principles (in order):
1. Steps that are prerequisites for other steps come first (e.g. identity verification before skills assessment).
2. Sponsorship/visa steps (stepSource=sponsorship) must be addressed early if the candidate needs a visa.
3. Steps with shorter timelines should generally come before longer ones to build momentum.
4. Steps that unblock multiple other pathways come before single-pathway steps.
5. Administrative steps (e.g. document gathering) precede skills/examination steps.

Respond ONLY with valid JSON matching exactly:
{
  "suggestions": [
    { "stepId": <number>, "suggestedOrder": <number starting from 1>, "rationale": "<string, max 120 chars>" }
  ],
  "overallRationale": "<string, max 300 chars>"
}`;

/**
 * Generates AI-powered step ordering suggestions for a remediation plan.
 * Uses GPT-4o in JSON mode with bounded prioritisation inputs.
 */
export async function prioritiseRemediationSteps(
  planId: number,
  steps: PrioritisableStep[]
): Promise<AiPrioritisationResult> {
  if (steps.length === 0) {
    return { suggestions: [], overallRationale: "No steps to prioritise." };
  }

  const stepsText = steps
    .map(
      (s) =>
        `{ "id": ${s.id}, "title": "${s.title}", "gap": "${s.gap}", "source": "${s.stepSource}"` +
        (s.timelineRange ? `, "timeline": "${s.timelineRange}"` : "") +
        (s.costRange ? `, "cost": "${s.costRange}"` : "") +
        (s.pathway ? `, "pathway": "${s.pathway}"` : "") +
        " }"
    )
    .join(",\n");

  const userPrompt = `Remediation plan #${planId} has ${steps.length} steps. Suggest the optimal order:
[${stepsText}]`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 1200,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: { suggestions?: unknown[]; overallRationale?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const suggestions: AiStepSuggestion[] = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter(
          (s): s is { stepId: number; suggestedOrder: number; rationale: string } =>
            typeof s === "object" &&
            s !== null &&
            typeof (s as Record<string, unknown>).stepId === "number" &&
            typeof (s as Record<string, unknown>).suggestedOrder === "number"
        )
        .map((s) => ({
          stepId: s.stepId,
          suggestedOrder: s.suggestedOrder,
          rationale: String(s.rationale ?? ""),
        }))
    : [];

  return {
    suggestions,
    overallRationale: parsed.overallRationale ?? "No overall rationale provided.",
  };
}
