export interface JobContext {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  pageUrl: string;
}

function getMeta(name: string): string {
  const el =
    document.querySelector<HTMLMetaElement>(`meta[property="${name}"]`) ??
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  return el?.content?.trim() ?? "";
}

function getFirstText(selectors: string[]): string {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

/**
 * Extract readable text from an element while skipping page chrome that
 * pollutes the AI context — form controls ("Choose File", "No file chosen",
 * "APPLY NOW"), navigation, cookie banners, scripts, etc.
 */
function extractCleanText(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  const noiseSelectors = [
    "script",
    "style",
    "noscript",
    "template",
    "iframe",
    "svg",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[aria-hidden='true']",
    "[class*='cookie' i]",
    "[id*='cookie' i]",
    "[class*='banner' i]",
    "[class*='breadcrumb' i]",
    "[class*='menu' i]",
    "[class*='nav' i]",
    "[class*='sidebar' i]",
    "[class*='skip-link' i]",
  ];
  clone.querySelectorAll(noiseSelectors.join(",")).forEach((el) => el.remove());

  const text = clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
  // Strip leftover boilerplate phrases that survive element removal.
  return text
    .replace(/\b(No file chosen|Choose File|Choose file|APPLY NOW|Apply now|Apply Now|Accept all cookies|Accept cookies|Cookie settings|Skip to (main )?content)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDescription(): string {
  const selectors = [
    // NHS Jobs
    ".nhsuk-body-m",
    "[data-test='job-description']",
    "#job-description",
    // Trac
    ".job-description",
    ".vacancy-description",
    // Workday
    "[data-automation-id='jobPostingDescription']",
    "[data-automation-id='job-posting-description']",
    // Generic
    "article",
    "main .description",
    "[class*='description']",
    "[id*='description']",
    "main",
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length > 100) return text.slice(0, 3000);
    }
  }
  return extractCleanText(document.body).slice(0, 3000);
}

function scrapeNhs(): Partial<JobContext> {
  return {
    jobTitle: getFirstText([
      "h1.nhsuk-heading-xl",
      ".nhsuk-page-heading h1",
      "h1",
    ]),
    companyName: getFirstText([
      ".nhsuk-summary-list__value",
      "[data-test='employer-name']",
      ".employer-name",
    ]),
  };
}

function scrapeTrac(): Partial<JobContext> {
  return {
    jobTitle: getFirstText([
      ".vacancy-title h1",
      ".job-title h1",
      "h1",
    ]),
    companyName: getFirstText([
      ".employer-name",
      ".trust-name",
      ".organisation-name",
    ]),
  };
}

function scrapeWorkday(): Partial<JobContext> {
  return {
    jobTitle: getFirstText([
      "[data-automation-id='jobPostingHeader']",
      "[data-automation-id='job-posting-header-title']",
      "h1",
    ]),
    companyName:
      getMeta("og:site_name") ||
      getFirstText([
        "[data-automation-id='legalEntityName']",
        "[data-automation-id='company-name']",
      ]),
  };
}

function scrapeFallback(): Partial<JobContext> {
  const ogTitle = getMeta("og:title");
  const titleTag = document.title?.trim();

  const jobTitle =
    getFirstText(["h1"]) ||
    ogTitle ||
    titleTag.split(/[-|–]/)[0]?.trim() ||
    titleTag;

  const companyName =
    getMeta("og:site_name") ||
    getFirstText([
      "[class*='company']",
      "[class*='employer']",
      "[class*='organisation']",
    ]) ||
    titleTag.split(/[-|–]/).pop()?.trim() ||
    new URL(location.href).hostname.replace(/^www\./, "");

  return { jobTitle, companyName };
}

/**
 * True when the current host is one of the job boards we have a dedicated
 * scraper for (or JOBSAGE itself). On unrecognized sites the extension stays
 * unobtrusive: the sidebar collapses to a small badge by default.
 */
export function isRecognizedJobBoard(): boolean {
  const host = location.hostname;
  return (
    host.includes("nhs.uk") ||
    host.includes("trac.jobs") ||
    host.includes("myworkdayjobs.com") ||
    host.includes("jobsage.co.uk")
  );
}

/**
 * Return true when the page has an application-form signal rather than only
 * job-board navigation/search UI. This intentionally favors hiding the
 * launcher on listing pages: a candidate can still opt in from the popup
 * when a site uses a custom form that cannot be identified locally.
 */
export function hasApplicationForm(): boolean {
  const applicationFieldSelector = [
    "textarea",
    "input[type='file']",
    "[name*='supporting' i]",
    "[id*='supporting' i]",
    "[name*='personal-statement' i]",
    "[id*='personal-statement' i]",
    "[name*='application-question' i]",
    "[id*='application-question' i]",
    "[data-automation-id*='question' i]",
    "[data-automation-id*='longtext' i]",
    "[data-automation-id*='long-text' i]",
    "[data-automation-id*='supporting' i]",
  ].join(",");

  if (document.querySelector(applicationFieldSelector)) return true;

  const path = `${location.pathname} ${location.search}`;
  if (!/\b(apply|application|candidate)\b/i.test(path)) return false;

  // Some first application steps contain only ordinary text/select controls.
  // Treat a form on an explicitly application-like route as useful, while
  // avoiding the search form on ordinary vacancy listings.
  return document.querySelector("form") !== null;
}

export function scrapeJobContext(): JobContext {
  const host = location.hostname;

  let partial: Partial<JobContext> = {};
  if (host.includes("nhs.uk")) {
    partial = scrapeNhs();
  } else if (host.includes("trac.jobs")) {
    partial = scrapeTrac();
  } else if (host.includes("myworkdayjobs.com")) {
    partial = scrapeWorkday();
  } else {
    partial = scrapeFallback();
  }

  return {
    jobTitle: partial.jobTitle || scrapeFallback().jobTitle || "Unknown role",
    companyName: partial.companyName || scrapeFallback().companyName || location.hostname,
    jobDescription: getDescription(),
    pageUrl: location.href,
  };
}
