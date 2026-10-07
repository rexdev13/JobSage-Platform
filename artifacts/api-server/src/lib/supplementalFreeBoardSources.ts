import type { BoardAdvert } from "./boardVacancyPipeline";
import { fetchText, makeAdvert, type FreeBoardSource } from "./freeBoardSources";
import { parseJobsAcUkHtml } from "./jobsAcUkClient";

const NHS_SCOTLAND_ORIGIN = "https://apply.jobs.scot.nhs.uk";
const CHARITYJOB_ORIGIN = "https://www.charityjob.co.uk";
const JOBS_AC_UK_ORIGIN = "https://www.jobs.ac.uk";
const JOBS_AC_UK_PAGE_SIZE = 25;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function attributeValue(tag: string, attribute: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${escapeRegExp(attribute)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match?.[2] ?? null;
}

function classBlocks(html: string, tagName: string, className: string): string[] {
  const matcher = new RegExp(
    `<${tagName}\\b(?=[^>]*\\bclass=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'])[^>]*>`,
    "gi",
  );
  const starts = [...html.matchAll(matcher)];
  return starts.map((match, index) => {
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? html.length;
    return html.slice(start, end);
  });
}

function classText(
  html: string,
  tagName: string,
  className: string,
): string | null {
  const matcher = new RegExp(
    `<${tagName}\\b(?=[^>]*\\bclass=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'])[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  const match = html.match(matcher);
  return match ? decodeHtmlText(match[1] ?? "") || null : null;
}

function inputValue(html: string, id: string, attribute: string): string | null {
  const input = html.match(
    new RegExp(`<input\\b(?=[^>]*\\bid=["']${escapeRegExp(id)}["'])[^>]*>`, "i"),
  )?.[0];
  return input ? attributeValue(input, attribute) : null;
}

function parseUkDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCursorOffset(cursor: string | null): number {
  if (cursor == null) return 0;
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Free vacancy feed offset cursor is invalid.");
  }
  return offset;
}

export function parseNhsScotlandJobCards(html: string): {
  adverts: BoardAdvert[];
  totalResults: number;
  recordsPerPage: number;
} {
  const totalValue = inputValue(html, "totalMatchRecords", "value");
  const totalResults = Number(totalValue?.replace(/,/g, ""));
  const recordsPerPageValue = inputValue(html, "totalCurrentRecords", "value");
  const recordsPerPage = Number(recordsPerPageValue);
  if (
    !Number.isInteger(totalResults) || totalResults < 0 ||
    !Number.isInteger(recordsPerPage) || recordsPerPage < 0 ||
    (totalResults > 0 && recordsPerPage === 0)
  ) {
    throw new Error("NHS Scotland search response omitted valid result totals.");
  }

  const source = {
    id: "nhs-scotland",
    provider: "nhs_scotland",
    boardName: "NHS Scotland",
    parserVersion: "nhs-scotland-html-v1",
  };
  const adverts = classBlocks(html, "div", "job-card").map((card) => {
    const titleLink = card.match(
      /<a\b[^>]*href=["']([^"']*\/Job\/JobDetail\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const href = titleLink?.[1] ? decodeHtmlText(titleLink[1]) : "";
    let url = "";
    let externalId = "";
    try {
      const parsed = new URL(href, NHS_SCOTLAND_ORIGIN);
      if (
        parsed.protocol === "https:" &&
        parsed.hostname === "apply.jobs.scot.nhs.uk" &&
        parsed.pathname === "/Job/JobDetail"
      ) {
        url = parsed.toString();
        externalId = parsed.searchParams.get("JobId")?.trim() ?? "";
      }
    } catch {
      // Keep the identity empty so the collector records a reviewable page failure.
    }

    const employer = (classText(card, "p", "school") ?? "")
      .replace(/^[^:]*:\s*/, "")
      .trim();
    const jobFamily = (classText(card, "p", "department") ?? "")
      .replace(/^[^:]*:\s*/, "")
      .trim();
    const employmentType = (classText(card, "p", "employmenttype") ?? "")
      .replace(/^[^:]*:\s*/, "")
      .trim();
    return makeAdvert(source, {
      externalId,
      title: titleLink?.[2] ? decodeHtmlText(titleLink[2]) : "",
      employer,
      url,
      location: (classText(card, "p", "location") ?? "").replace(/^[^:]*:\s*/, ""),
      salary: (classText(card, "p", "salary") ?? "").replace(/^[^:]*:\s*/, ""),
      postedDate: parseUkDate(
        (classText(card, "p", "livedate") ?? "").replace(/^[^:]*:\s*/, ""),
      ) ?? undefined,
      closesAt: parseUkDate(
        (classText(card, "p", "closingdate") ?? "").replace(/^[^:]*:\s*/, ""),
      ) ?? undefined,
      metadata: {
        country: "GB",
        category: jobFamily || null,
        employmentType: employmentType || null,
      },
    });
  });

  return { adverts, totalResults, recordsPerPage };
}

function parseCharityJobNextPage(html: string, currentPage: number): number | null {
  const tags = html.match(/<(?:a|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/\brel=["'][^"']*\bnext\b[^"']*["']/i.test(tag)) continue;
    const href = attributeValue(tag, "href");
    if (!href) continue;
    try {
      const next = new URL(href, CHARITYJOB_ORIGIN);
      const page = Number(next.searchParams.get("page") ?? "1");
      if (
        next.protocol === "https:" &&
        next.hostname === "www.charityjob.co.uk" &&
        next.pathname.replace(/\/+$/, "") === "/jobs" &&
        Number.isInteger(page) &&
        page > currentPage
      ) {
        return page;
      }
    } catch {
      // Ignore malformed pagination links.
    }
  }
  return null;
}

export function parseCharityJobPage(html: string): {
  adverts: BoardAdvert[];
  recordsFetched: number;
  duplicateListingsSkipped: number;
} {
  const source = {
    id: "charityjob",
    provider: "charityjob",
    boardName: "CharityJob",
    parserVersion: "charityjob-html-v2",
  };
  const cards = classBlocks(html, "article", "job-card-wrapper");
  const advertsById = new Map<string, BoardAdvert>();
  let duplicateListingsSkipped = 0;
  for (const card of cards) {
    if (/\bis-expired-job=["']true["']/i.test(card) ||
        /\bis-future-job=["']true["']/i.test(card)) {
      continue;
    }
    const jobLink = card.match(
      /<a\b[^>]*href=["'](https:\/\/www\.charityjob\.co\.uk\/jobs\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!jobLink?.[1] || !jobLink[2]) continue;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(decodeHtmlText(jobLink[1]));
    } catch {
      continue;
    }
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "www.charityjob.co.uk" ||
      !/^\/jobs\/[^/?#]+\/[^/?#]+\/\d+\/?$/i.test(parsedUrl.pathname)
    ) {
      continue;
    }
    const externalId = pathParts.at(-1) ?? "";
    const title = decodeHtmlText(jobLink[2]);
    const logoAnchor = (card.match(/<a\b[^>]*>/gi) ?? [])
      .find((tag) => /\bclass=["'][^"']*\bjob-card-logo\b[^"']*["']/i.test(tag));
    const logoImage = (card.match(/<img\b[^>]*>/gi) ?? [])
      .find((tag) => /\balt=["'][^"']+["']/i.test(tag));
    const employer = (logoAnchor && attributeValue(logoAnchor, "title")) ||
      (logoImage && attributeValue(logoImage, "alt")) || "";
    const organisation = classText(card, "div", "organisation") ?? "";
    const location = employer && organisation.toLowerCase().startsWith(employer.toLowerCase())
      ? organisation.slice(employer.length).replace(/^[,\s-]+/, "")
      : null;
    const salaryBlock = classBlocks(card, "div", "job-summary-item")
      .map(decodeHtmlText)
      .find((value) => /£|€|\$|salary/i.test(value));
    const advert = makeAdvert(source, {
      externalId,
      title,
      employer: decodeHtmlText(employer),
      url: parsedUrl.toString(),
      location,
      salary: salaryBlock ?? null,
      metadata: { country: "GB", category: "charity" },
    });
    if (externalId && !advertsById.has(externalId)) {
      advertsById.set(externalId, advert);
    } else if (externalId) {
      duplicateListingsSkipped++;
    }
  }
  return {
    adverts: [...advertsById.values()],
    recordsFetched: cards.length,
    duplicateListingsSkipped,
  };
}

function parseJobsAcUkReportedTotal(html: string): number | undefined {
  const text = decodeHtmlText(html);
  const matches = [...text.matchAll(/([\d,]+)\s+Jobs?\s+Found\b/gi)];
  const value = matches.at(-1)?.[1];
  if (!value) return undefined;
  const total = Number(value.replace(/,/g, ""));
  return Number.isInteger(total) && total >= 0 ? total : undefined;
}

export function getJobsAcUkPageCoverageWarning(
  startIndex: number,
  reportedTotal: number | undefined,
  returnedCount: number,
  unseenCount: number,
): string | null {
  if (reportedTotal == null) {
    return "jobs.ac.uk coverage needs review: the search page omitted its result total.";
  }
  const expected = Math.min(JOBS_AC_UK_PAGE_SIZE, Math.max(0, reportedTotal - startIndex + 1));
  if (returnedCount !== expected) {
    return `jobs.ac.uk coverage needs review: index ${startIndex} returned ${returnedCount} listings; expected ${expected} from the reported total ${reportedTotal}.`;
  }
  if (returnedCount > 0 && unseenCount === 0) {
    return `jobs.ac.uk coverage needs review: index ${startIndex} repeated only previously seen listings before coverage could be verified.`;
  }
  return null;
}

export const SUPPLEMENTAL_FREE_BOARD_SOURCES: readonly FreeBoardSource[] = [
  {
    id: "nhs-scotland",
    provider: "nhs_scotland",
    boardName: "NHS Scotland",
    parserVersion: "nhs-scotland-html-v1",
    maxPagesPerRun: 120,
    reconcileMissingAfterSweep: false,
    async fetchPage({ cursor, deadlineMs }) {
      const offset = parseCursorOffset(cursor);
      const url = new URL("/Home/_JobCard", NHS_SCOTLAND_ORIGIN);
      for (const [key, value] of Object.entries({
        Skip: String(offset),
        what: "",
        Miles: "",
        Salary: "",
        LocationId: "",
        Regions: "",
        DivisionIds: "",
        ClientCategory: "",
        Departments: "",
        SchoolLocationId: "",
        JobLevels: "",
        SchoolSubjectId: "",
        JobTypeIds: "",
        lat: "",
        long: "",
        EmploymentType: "",
        postedDate: "",
      })) {
        url.searchParams.set(key, value);
      }
      const html = await fetchText(url.toString(), deadlineMs);
      const parsed = parseNhsScotlandJobCards(html);
      if (parsed.totalResults > offset && parsed.adverts.length === 0) {
        throw new Error("NHS Scotland reported more vacancies but returned no job cards.");
      }
      const nextOffset = offset + parsed.recordsPerPage;
      return {
        adverts: parsed.adverts,
        recordsFetched: parsed.adverts.length,
        reportedTotal: parsed.totalResults,
        nextCursor: nextOffset < parsed.totalResults ? String(nextOffset) : null,
      };
    },
  },
  {
    id: "jobs-ac-uk",
    provider: "jobs_ac_uk",
    boardName: "jobs.ac.uk",
    parserVersion: "jobs-ac-uk-search-v1",
    maxPagesPerRun: 160,
    reconcileMissingAfterSweep: false,
    async fetchPage({ cursor, deadlineMs, seenExternalIds }) {
      const startIndex = cursor == null ? 1 : Number(cursor);
      if (!Number.isInteger(startIndex) || startIndex < 1) {
        throw new Error("jobs.ac.uk search cursor is invalid.");
      }
      const url = new URL("/search/", JOBS_AC_UK_ORIGIN);
      url.searchParams.set("keywords", "");
      url.searchParams.set("sortOrder", "1");
      url.searchParams.set("pageSize", String(JOBS_AC_UK_PAGE_SIZE));
      url.searchParams.set("startIndex", String(startIndex));
      const html = await fetchText(url.toString(), deadlineMs);
      const fetched = parseJobsAcUkHtml(html);
      const reportedTotal = parseJobsAcUkReportedTotal(html);
      const unseen = fetched.filter((vacancy) =>
        !seenExternalIds.has(vacancy.externalListingId));
      const adverts = unseen.map((vacancy) => makeAdvert(
        {
          id: "jobs-ac-uk",
          provider: "jobs_ac_uk",
          boardName: "jobs.ac.uk",
          parserVersion: "jobs-ac-uk-search-v1",
        },
        {
          externalId: vacancy.externalListingId,
          title: vacancy.title,
          employer: vacancy.employer,
          url: vacancy.url,
          location: vacancy.location,
          salary: vacancy.salary,
          // The board's list page only exposes day/month labels, not a reliable year.
          postedDate: undefined,
          closesAt: vacancy.closesAt?.toISOString(),
          metadata: {
            country: "GB",
            sourcePostedLabel: vacancy.postedDate,
          },
        },
      ));
      const reachedReportedEnd = reportedTotal != null &&
        startIndex + JOBS_AC_UK_PAGE_SIZE > reportedTotal;
      const coverageWarning = getJobsAcUkPageCoverageWarning(
        startIndex, reportedTotal, fetched.length, unseen.length,
      );
      return {
        adverts,
        recordsFetched: fetched.length,
        ...(reportedTotal == null ? {} : { reportedTotal }),
        nextCursor: coverageWarning ? String(startIndex)
          : reachedReportedEnd ? null : String(startIndex + JOBS_AC_UK_PAGE_SIZE),
        ...(coverageWarning ? { coverageWarning } : {}),
      };
    },
  },
  {
    id: "charityjob",
    provider: "charityjob",
    boardName: "CharityJob",
    parserVersion: "charityjob-html-v2",
    maxPagesPerRun: 200,
    reconcileMissingAfterSweep: false,
    async fetchPage({ cursor, deadlineMs, seenExternalIds }) {
      const page = cursor == null ? 1 : Number(cursor);
      if (!Number.isInteger(page) || page < 1) {
        throw new Error("CharityJob page cursor is invalid.");
      }
      const url = new URL("/jobs", CHARITYJOB_ORIGIN);
      if (page > 1) url.searchParams.set("page", String(page));
      const html = await fetchText(url.toString(), deadlineMs);
      const parsed = parseCharityJobPage(html);
      const unseen = parsed.adverts.filter((advert) =>
        !advert.externalId || !seenExternalIds.has(advert.externalId));
      const nextPage = parseCharityJobNextPage(html, page);
      if (nextPage != null && parsed.adverts.length === 0) {
        throw new Error("CharityJob returned an empty page with a next-page link.");
      }
      return {
        adverts: unseen,
        recordsFetched: parsed.recordsFetched,
        duplicateListingsSkipped:
          parsed.duplicateListingsSkipped + parsed.adverts.length - unseen.length,
        nextCursor: nextPage == null ? null : String(nextPage),
      };
    },
  },
];
