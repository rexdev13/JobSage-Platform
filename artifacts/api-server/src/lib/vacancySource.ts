import {
  isValidJobBoardVacancyDeepLink,
  isValidVacancyDeepLink,
} from "./vacancyUrlPolicy";

export type VacancySourceType = "job_board" | "company_site";

export interface VacancySourceMetadata {
  sourceType: VacancySourceType | null;
  boardName: string | null;
  externalListingId: string | null;
}

const TRACKING_PARAMETERS = new Set([
  "ref",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

export function canonicalVacancyUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function boardMetadata(url: URL): Omit<VacancySourceMetadata, "sourceType"> | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (hostMatches(host, "jobs.nhs.uk")) {
    return {
      boardName: "NHS Jobs",
      externalListingId: path.match(/\/jobadvert\/([^/?#]+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "trac.jobs")) {
    return {
      boardName: "Trac",
      externalListingId: path.match(/\/job-advert\/([^/?#]+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "healthjobsuk.com")) {
    return {
      boardName: "HealthJobsUK",
      externalListingId: path.match(/\/job\/([^/?#]+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "reed.co.uk")) {
    return {
      boardName: "Reed",
      externalListingId: path.match(/\/(\d+)\/?$/)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "indeed.com")) {
    return { boardName: "Indeed", externalListingId: url.searchParams.get("jk") };
  }
  if (hostMatches(host, "cv-library.co.uk")) {
    return {
      boardName: "CV-Library",
      externalListingId: path.match(/\/job\/(\d+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "totaljobs.com")) {
    return {
      boardName: "TotalJobs",
      externalListingId: path.match(/\/job\/[^/]+\/([^/?#]+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "jobs.ac.uk")) {
    return {
      boardName: "jobs.ac.uk",
      externalListingId: path.match(/\/job\/([a-z0-9]+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "teaching-vacancies.service.gov.uk")) {
    return {
      boardName: "Teaching Vacancies",
      externalListingId: path.match(/\/jobs\/([^/?#]+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "arbeitnow.com")) {
    return {
      boardName: "Arbeitnow",
      externalListingId: path.match(/\/jobs\/(?:companies\/[^/?#]+\/)?([^/?#]+)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "jobicy.com")) {
    return {
      boardName: "Jobicy",
      externalListingId: path.match(/\/(?:jobs|job)\/([^/?#]+(?:\/[^/?#]+)*)/i)?.[1] ?? null,
    };
  }
  if (hostMatches(host, "himalayas.app")) {
    return {
      boardName: "Himalayas",
      externalListingId: path.match(/\/(?:jobs\/|companies\/[^/?#]+\/jobs\/)([^/?#]+)/i)?.[1] ?? null,
    };
  }
  return null;
}

export function classifyVacancySource(value: string | null | undefined): VacancySourceMetadata {
  if (!value) return { sourceType: null, boardName: null, externalListingId: null };
  try {
    const url = new URL(value);
    const board = boardMetadata(url);
    if (board && isValidJobBoardVacancyDeepLink(value)) {
      return { sourceType: "job_board", ...board };
    }
    if (isValidVacancyDeepLink(value)) {
      return { sourceType: "company_site", boardName: null, externalListingId: null };
    }
  } catch {
    // Invalid URLs remain unclassified.
  }
  return { sourceType: null, boardName: null, externalListingId: null };
}

export function vacancyStorageKey(organisationName: string, url: string): string | null {
  const canonical = canonicalVacancyUrl(url);
  return canonical ? `${organisationName.trim().toLowerCase()}|${canonical}` : null;
}
