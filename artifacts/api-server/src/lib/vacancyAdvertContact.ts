import type { BoardAdvert } from "./boardVacancyPipeline";
import {
  fetchCompanySitePage,
  requestPinned,
  resolveAndPinPublicAddress,
} from "./companySiteHttp";
import {
  extractAdvertContactEmail,
  validatePublishedContactEmail,
} from "./publishedContactEmail";

export const ADVERT_CONTACT_FETCH_TIMEOUT_MS = 9_000;
export const ADVERT_CONTACT_MAX_BYTES = 1_000_000;
export const ADVERT_CONTACT_CONCURRENCY = 5;

type FetchedAdvert = {
  body: string;
  url: string;
};

export type EnrichedAdvertContactResult = {
  advert: BoardAdvert;
  fetched: boolean;
};

async function fetchAdvertHtml(
  url: string,
  sourceType: BoardAdvert["sourceType"],
): Promise<FetchedAdvert | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  try {
    if (sourceType === "company_site" && url && parsed.hostname && parsed.hostname !== "") {
      // Company-site adverts must share the existing robots, host pacing,
      // public-DNS, redirect, and wall-clock controls.
      const companySite = await fetchCompanySitePage(
        url,
        parsed.hostname,
        Date.now() + ADVERT_CONTACT_FETCH_TIMEOUT_MS,
      );
      if (companySite.ok) {
        return { body: companySite.body, url: companySite.url };
      }
      // Board adverts do not use company-site host state. Fall through to
      // the pinned board fetch only for known job-board URLs.
    }
    const pinned = await resolveAndPinPublicAddress(parsed.hostname);
    const response = await requestPinned(
      parsed,
      pinned,
      ADVERT_CONTACT_FETCH_TIMEOUT_MS,
      ADVERT_CONTACT_MAX_BYTES,
    );
    if (response.status < 200 || response.status >= 300) return null;
    return { body: response.body, url };
  } catch {
    return null;
  }
}

/**
 * Re-check the complete stored advert text first, then fetch the advert URL
 * when the source parser did not provide a usable published contact. The
 * extractor only accepts addresses actually present in the advert and the
 * validator rejects free, no-reply, ATS, and board mailboxes.
 */
export async function enrichAdvertContactWithStats(
  advert: BoardAdvert,
): Promise<EnrichedAdvertContactResult> {
  const inlineEmail = extractAdvertContactEmail(advert.description ?? "", advert.url);
  const suppliedEmail = validatePublishedContactEmail(advert.contactEmail);
  if (suppliedEmail && advert.contactEvidenceUrl) {
    return {
      advert: { ...advert, contactEmail: suppliedEmail },
      fetched: false,
    };
  }
  if (inlineEmail) {
    return {
      advert: {
        ...advert,
        contactEmail: inlineEmail,
        contactEvidenceUrl: advert.url,
      },
      fetched: false,
    };
  }

  const fetched = await fetchAdvertHtml(advert.url, advert.sourceType);
  if (!fetched) return { advert, fetched: true };
  const fetchedEmail = extractAdvertContactEmail(fetched.body, fetched.url);
  return {
    advert: fetchedEmail
      ? {
          ...advert,
          contactEmail: fetchedEmail,
          contactEvidenceUrl: fetched.url,
        }
      : advert,
    fetched: true,
  };
}

export async function enrichAdvertContact(advert: BoardAdvert): Promise<BoardAdvert> {
  return (await enrichAdvertContactWithStats(advert)).advert;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker(),
    ),
  );
  return results;
}

export async function enrichAdvertContacts(
  adverts: readonly BoardAdvert[],
  concurrency = ADVERT_CONTACT_CONCURRENCY,
): Promise<BoardAdvert[]> {
  const enriched = await enrichAdvertContactsWithStats(adverts, concurrency);
  return enriched.map(({ advert }) => advert);
}

export async function enrichAdvertContactsWithStats(
  adverts: readonly BoardAdvert[],
  concurrency = ADVERT_CONTACT_CONCURRENCY,
): Promise<EnrichedAdvertContactResult[]> {
  return mapWithConcurrency(adverts, concurrency, enrichAdvertContactWithStats);
}