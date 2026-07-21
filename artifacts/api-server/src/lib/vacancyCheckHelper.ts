import { db } from "@workspace/db";
import {
  sponsorLicenceVacancyChecksTable,
  sponsorLicenceVacanciesTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { eq, and, gt, desc } from "drizzle-orm";

export const VACANCY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Third-party aggregator domains whose vacancy URLs we do not want to store.
 * Add new entries here as needed — hostname matching is suffix-based so
 * subdomains (e.g. uk.indeed.com) are also caught.
 */
export const BLOCKED_VACANCY_DOMAINS = [
  "indeed.com",
  "reed.co.uk",
  "linkedin.com",
  "cv-library.co.uk",
  "totaljobs.com",
  "glassdoor.com",
] as const;

function isBlockedVacancyUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return BLOCKED_VACANCY_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

export type VacancyListItem = {
  title: string;
  location: string | null;
  salary: string | null;
  url: string | null;
  description: string | null;
  postedDate: string | null;
};

export type VacancyCheckResult = {
  vacanciesFound: boolean;
  vacancyCount: number | null;
  sourceUrl: string | null;
  summary: string;
  checkedAt: Date;
  fromCache: boolean;
  vacancyList: VacancyListItem[] | null;
};

function extractOutermostJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Run a vacancy check for a named sponsor licence company.
 * Returns a cached result (within 24h TTL) if one exists, otherwise
 * calls the OpenAI web search tool, persists the result, and returns it.
 * Safe to call from both HTTP handlers and background schedulers.
 */
export async function runVacancyCheck(organisationName: string): Promise<VacancyCheckResult> {
  const cutoff = new Date(Date.now() - VACANCY_CACHE_TTL_MS);
  const [cached] = await db
    .select()
    .from(sponsorLicenceVacancyChecksTable)
    .where(
      and(
        eq(sponsorLicenceVacancyChecksTable.organisationName, organisationName),
        gt(sponsorLicenceVacancyChecksTable.checkedAt, cutoff),
      ),
    )
    .orderBy(desc(sponsorLicenceVacancyChecksTable.checkedAt))
    .limit(1);

  if (cached) {
    return {
      vacanciesFound: cached.vacanciesFound,
      vacancyCount: cached.vacancyCount,
      sourceUrl: cached.sourceUrl,
      summary: cached.summary ?? "No active vacancies found.",
      checkedAt: cached.checkedAt,
      fromCache: true,
      vacancyList: (cached.vacancyList as VacancyListItem[] | null) ?? null,
    };
  }

  let vacanciesFound = false;
  let vacancyCount: number | null = null;
  let sourceUrl: string | null = `https://www.reed.co.uk/jobs?keywords=${encodeURIComponent(organisationName)}&locationName=United+Kingdom`;
  let summary = "No active vacancies found.";
  let vacancyList: VacancyListItem[] | null = null;

  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" as const }],
      input: `Search for current job openings at "${organisationName}" in the United Kingdom.
Prioritise the company's own careers page and NHS Jobs (jobs.nhs.uk) first. Only use third-party aggregators such as Indeed, Reed, LinkedIn, or CV-Library as a last resort, and prefer URLs that point directly to the employer's own domain.
After searching, reply with a JSON object ONLY — no markdown, no extra text, just raw JSON:
{
  "vacanciesFound": true or false,
  "vacancyCount": number or null,
  "sourceUrl": "URL to search results or careers page",
  "summary": "1-2 sentence summary of what you found",
  "vacancyList": [
    {
      "title": "Job title",
      "location": "City, County or null",
      "salary": "£XX,XXX - £XX,XXX or null",
      "url": "direct link to job posting or null",
      "description": "2-3 sentence description of the role or null",
      "postedDate": "YYYY-MM-DD or relative like '3 days ago' or null"
    }
  ]
}
Include up to 8 specific vacancies in vacancyList if found. Use null for missing fields. vacancyList must be an empty array if no vacancies found.`,
    });

    const text = response.output_text ?? "";
    const jsonStr = extractOutermostJson(text);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr) as {
        vacanciesFound?: boolean;
        vacancyCount?: number | null;
        sourceUrl?: string | null;
        summary?: string;
        vacancyList?: Array<{
          title?: string;
          location?: string | null;
          salary?: string | null;
          url?: string | null;
          description?: string | null;
          postedDate?: string | null;
        }>;
      };
      vacanciesFound = parsed.vacanciesFound === true;
      vacancyCount = typeof parsed.vacancyCount === "number" ? parsed.vacancyCount : null;
      if (typeof parsed.sourceUrl === "string" && parsed.sourceUrl.startsWith("http")) {
        sourceUrl = parsed.sourceUrl;
      }
      summary = typeof parsed.summary === "string"
        ? parsed.summary
        : (vacanciesFound
          ? `Vacancies found for ${organisationName}.`
          : `No active vacancies found for ${organisationName}.`);
      if (Array.isArray(parsed.vacancyList) && parsed.vacancyList.length > 0) {
        vacancyList = parsed.vacancyList
          .filter((v) => typeof v.title === "string" && v.title.trim())
          .filter((v) => {
            // Discard vacancies whose URL points to a blocked aggregator domain.
            // Vacancies with null/undefined/non-http URLs pass through and are
            // stored with url: null (existing behaviour).
            if (typeof v.url === "string" && v.url.startsWith("http")) {
              return !isBlockedVacancyUrl(v.url);
            }
            return true;
          })
          .map((v) => ({
            title: (v.title ?? "").trim(),
            location: typeof v.location === "string" ? v.location.trim() || null : null,
            salary: typeof v.salary === "string" ? v.salary.trim() || null : null,
            url: typeof v.url === "string" && v.url.startsWith("http") ? v.url.trim() : null,
            description: typeof v.description === "string" ? v.description.trim() || null : null,
            postedDate: typeof v.postedDate === "string" ? v.postedDate.trim() || null : null,
          }))
          .slice(0, 8);
        if (vacancyList.length > 0 && !vacancyCount) {
          vacancyCount = vacancyList.length;
        }
      }
    }
  } catch (aiErr) {
    console.warn(
      `[vacancy-check] AI check failed for "${organisationName}":`,
      aiErr instanceof Error ? aiErr.message : aiErr,
    );
  }

  const [saved] = await db
    .insert(sponsorLicenceVacancyChecksTable)
    .values({ organisationName, vacanciesFound, vacancyCount, sourceUrl, summary, vacancyList })
    .returning();

  // Persist individual vacancy rows — delete stale snapshot first, then insert current one.
  // Keeps sponsor_licence_vacancies as a point-in-time snapshot (not accumulating history).
  await db
    .delete(sponsorLicenceVacanciesTable)
    .where(eq(sponsorLicenceVacanciesTable.organisationName, organisationName));

  if (vacancyList && vacancyList.length > 0) {
    const checkDate = new Date().toISOString().split("T")[0]!;
    await db.insert(sponsorLicenceVacanciesTable).values(
      vacancyList.map((v) => ({
        organisationName,
        checkDate,
        title: v.title,
        location: v.location ?? null,
        salary: v.salary ?? null,
        url: v.url ?? null,
        description: v.description ?? null,
        postedDate: v.postedDate ?? null,
      })),
    );
  }

  return {
    vacanciesFound,
    vacancyCount,
    sourceUrl,
    summary,
    checkedAt: saved?.checkedAt ?? new Date(),
    fromCache: false,
    vacancyList,
  };
}
