import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stringifyCsv } from "./csv";

const CQC_DATA_PAGE = "https://www.cqc.org.uk/about-us/transparency/using-cqc-data";
const GIAS_DOWNLOADS_PAGE = "https://get-information-schools.service.gov.uk/Downloads";
const CHARITY_API_BASE = "https://api.charitycommission.gov.uk/register/api";
const CHARITY_REGISTER_BASE = "https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details";
const MAX_SOURCE_BYTES = 120 * 1024 * 1024;
const GIAS_STATE_FILE = "gias-generation-state.json";
const execFileAsync = promisify(execFile);

export type SourceDownload = {
  path?: string;
  sourceUrl?: string;
  warning?: string;
};

function datedFile(cacheDir: string, name: string, extension: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(cacheDir, `${name}-${date}.${extension}`);
}

async function fetchBody(url: string, timeoutMs = 90_000): Promise<{ body: Buffer; contentType: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": "JOBSAGE sponsor contact discovery/1.0", Accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_SOURCE_BYTES) throw new Error("source exceeds 120 MB safety limit");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_SOURCE_BYTES) throw new Error("source exceeds 120 MB safety limit");
  return { body, contentType: response.headers.get("content-type") ?? "" };
}

function sourceStatus(source: string, status: string, detail?: string): void {
  console.log(JSON.stringify({ type: "source_status", source, status, ...(detail ? { detail } : {}) }));
}

function retryAfterMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after") ?? "");
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 30_000);
  return Math.min(1_000 * 2 ** attempt, 30_000);
}

async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs: number,
  maxRetries = 5,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok || (response.status < 500 && response.status !== 429)) return response;
    if (attempt >= maxRetries) {
      throw new Error(`${label} HTTP ${response.status} after ${maxRetries + 1} attempts`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response, attempt)));
  }
}

async function cacheDownload(
  cacheDir: string,
  name: string,
  url: string,
  extension = "csv",
): Promise<SourceDownload> {
  const path = datedFile(cacheDir, name, extension);
  try {
    await readFile(path);
    return { path, sourceUrl: url };
  } catch {
    // Cache miss.
  }
  const result = await fetchBody(url);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, result.body);
  return { path, sourceUrl: url };
}

async function validGiasCsv(path: string): Promise<boolean> {
  try {
    const sample = (await readFile(path)).subarray(0, 16_384).toString("utf8");
    return !/<html|<!doctype/i.test(sample) &&
      /(?:establishment|school\s*website|main\s*email|urn)/i.test(sample);
  } catch {
    return false;
  }
}

async function validCsvFile(path: string): Promise<boolean> {
  try {
    const sample = (await readFile(path)).subarray(0, 16_384).toString("utf8");
    return !/<html|<!doctype/i.test(sample) && sample.includes(",");
  } catch {
    return false;
  }
}

async function latestValidGias(cacheDir: string): Promise<string | undefined> {
  try {
    const cached = (await readdir(cacheDir))
      .filter((name) => /^gias-establishments-\d{4}-\d{2}-\d{2}\.csv$/.test(name))
      .sort()
      .reverse();
    for (const name of cached) {
      const path = join(cacheDir, name);
      if (await validGiasCsv(path)) return path;
    }
  } catch {
    // Cache directory may not exist yet.
  }
  return undefined;
}

function firstCsvUrl(html: string, host: string): string | null {
  const matches = html.match(/https?:\/\/[^"'\s>]+\.csv/gi) ?? [];
  return matches.find((candidate) => {
    try {
      return new URL(candidate).hostname === host;
    } catch {
      return false;
    }
  }) ?? null;
}

async function discoverCqc(cacheDir: string): Promise<SourceDownload> {
  const page = await fetchBody(CQC_DATA_PAGE);
  const pageText = page.body.toString("utf8");
  const url = firstCsvUrl(pageText, "www.cqc.org.uk");
  if (!url) throw new Error("CQC data page did not expose a CSV download link");
  return cacheDownload(cacheDir, "cqc-directory", url);
}

function hiddenInputs(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of html.matchAll(/<input\b[^>]*type=["']hidden["'][^>]*>/gi)) {
    const tag = match[0]!;
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    const value = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1];
    if (name && value !== undefined) values[name] = value;
  }
  return values;
}

type GiasGenerationState = {
  generatedId: string;
  generatedPageUrl: string;
  cookieHeader: string;
  startedAt: string;
};

async function readGiasState(cacheDir: string): Promise<GiasGenerationState | undefined> {
  try {
    const state = JSON.parse(await readFile(join(cacheDir, GIAS_STATE_FILE), "utf8")) as GiasGenerationState;
    if (!state.generatedId || !state.generatedPageUrl || Date.now() - Date.parse(state.startedAt) > 48 * 60 * 60 * 1_000) {
      return undefined;
    }
    return state;
  } catch {
    return undefined;
  }
}

async function writeGiasState(cacheDir: string, state: GiasGenerationState): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, GIAS_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function clearGiasState(cacheDir: string): Promise<void> {
  await unlink(join(cacheDir, GIAS_STATE_FILE)).catch(() => undefined);
}

function cookieFrom(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function extractGias(
  cacheDir: string,
  state: GiasGenerationState,
): Promise<SourceDownload> {
  const headers = {
    "User-Agent": "JOBSAGE sponsor contact discovery/1.0",
    Accept: "text/html",
    ...(state.cookieHeader ? { Cookie: state.cookieHeader } : {}),
  };
  let body: Buffer | undefined;
  let finalUrl = state.generatedPageUrl;
  let contentType = "";
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const pollingUrl = new URL(`/Downloads/GenerateAjax/${state.generatedId}`, GIAS_DOWNLOADS_PAGE);
    const poll = await fetchWithBackoff(pollingUrl.toString(), {
      headers: { ...headers, Accept: "application/json" },
    }, "GIAS generation polling", 30_000);
    const parsed = JSON.parse(await poll.text());
    const status = typeof parsed === "string" ? JSON.parse(parsed) : parsed as { status?: boolean; redirect?: string };
    if (status.status && status.redirect) {
      const generatedPage = await fetchWithBackoff(new URL(status.redirect, GIAS_DOWNLOADS_PAGE).toString(), {
        headers,
      }, "GIAS generated page", 30_000);
      const generatedHtml = await generatedPage.text();
      const extractAction = generatedHtml.match(/<form\b[^>]*action=["']([^"']*\/Downloads\/Download\/Extract)["']/i)?.[1];
      const extractFields = hiddenInputs(generatedHtml);
      if (!extractAction || !extractFields.id || !extractFields.path) {
        throw new Error("GIAS generated page did not expose its protected download form");
      }
      const extractForm = new URLSearchParams();
      for (const [key, value] of Object.entries(extractFields)) extractForm.set(key, value);
      const extracted = await fetchWithBackoff(new URL(extractAction, GIAS_DOWNLOADS_PAGE).toString(), {
        method: "POST",
        headers: {
          ...headers,
          Accept: "*/*",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: extractForm,
        redirect: "follow",
      }, "GIAS file extraction", 120_000);
      body = Buffer.from(await extracted.arrayBuffer());
      finalUrl = extracted.url;
      contentType = extracted.headers.get("content-type") ?? "";
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!body) throw new Error("GIAS CSV generation timed out after 10 minutes");
  if (body.byteLength < 1_000 || body.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("GIAS download response was not a valid bounded CSV/archive");
  }
  if (/text\/html/i.test(contentType) && !/\.csv|\.zip/i.test(finalUrl)) {
    throw new Error("GIAS generation returned HTML instead of a downloadable file");
  }
  const extension = /zip/i.test(finalUrl) || /zip/i.test(contentType) ? "zip" : "csv";
  const path = datedFile(cacheDir, "gias-establishments", extension);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, body);
  if (extension === "zip") {
    const listing = await execFileAsync("unzip", ["-Z1", path], { maxBuffer: 1_000_000 });
    const csvEntry = listing.stdout.split(/\r?\n/).find((entry) => /\.csv$/i.test(entry));
    if (!csvEntry) throw new Error("GIAS archive did not contain a CSV file");
    const extractedPath = datedFile(cacheDir, "gias-establishments", "csv");
    const extracted = await execFileAsync("unzip", ["-p", path, csvEntry], {
      maxBuffer: MAX_SOURCE_BYTES,
    });
    await writeFile(extractedPath, extracted.stdout);
    await clearGiasState(cacheDir);
    return { path: extractedPath, sourceUrl: GIAS_DOWNLOADS_PAGE };
  }
  if (!(await validGiasCsv(path))) throw new Error("GIAS generated file was not a recognizable CSV");
  await clearGiasState(cacheDir);
  return { path, sourceUrl: GIAS_DOWNLOADS_PAGE };
}

async function discoverGias(cacheDir: string): Promise<SourceDownload> {
  const cachedPath = await latestValidGias(cacheDir);
  if (cachedPath) {
    sourceStatus("gias", "cached", cachedPath);
    return { path: cachedPath, sourceUrl: GIAS_DOWNLOADS_PAGE };
  }

  const existing = await readGiasState(cacheDir);
  if (existing) {
    sourceStatus("gias", "resumed");
    return extractGias(cacheDir, existing);
  }

  const pageResponse = await fetchWithBackoff(GIAS_DOWNLOADS_PAGE, {
    headers: { "User-Agent": "JOBSAGE sponsor contact discovery/1.0", Accept: "text/html" },
  }, "GIAS downloads page", 30_000);
  const html = await pageResponse.text();
  const hidden = hiddenInputs(html);
  const token = hidden.__RequestVerificationToken;
  const tagMatch = html.match(
    /name=["']Downloads\[(\d+)\]\.Tag["'][^>]*value=["'](all\.edubase\.data)["']/i,
  );
  const dateMatch = html.match(
    /name=["']Downloads\[(\d+)\]\.FileGeneratedDate["'][^>]*value=["']([^"']+)["']/i,
  );
  if (!token || !tagMatch || !dateMatch || tagMatch[1] !== dateMatch[1]) {
    throw new Error("GIAS downloads page did not expose the establishment CSV form");
  }
  const index = tagMatch[1]!;
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(hidden)) form.set(key, value);
  form.set(`Downloads[${index}].Tag`, tagMatch[2]!);
  form.set(`Downloads[${index}].FileGeneratedDate`, dateMatch[2]!);
  form.set(`Downloads[${index}].Selected`, "true");
  const cookieHeader = cookieFrom(pageResponse);
  const post = await fetchWithBackoff(new URL("/Downloads/Collate", GIAS_DOWNLOADS_PAGE).toString(), {
    method: "POST",
    headers: {
      "User-Agent": "JOBSAGE sponsor contact discovery/1.0",
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: form,
    redirect: "follow",
  }, "GIAS download request", 120_000);
  let body = Buffer.from(await post.arrayBuffer());
  let finalUrl = post.url;
  let contentType = post.headers.get("content-type") ?? "";
  if (/text\/html/i.test(contentType) && /\/Downloads\/Generated\//i.test(finalUrl)) {
    const generatedIndex = finalUrl.toLowerCase().indexOf("/generated/");
    const generatedId = finalUrl.slice(generatedIndex + "/generated/".length).split("?")[0];
    const state: GiasGenerationState = {
      generatedId,
      generatedPageUrl: finalUrl,
      cookieHeader,
      startedAt: new Date().toISOString(),
    };
    await writeGiasState(cacheDir, state);
    sourceStatus("gias", "started");
    return extractGias(cacheDir, state);
  }
  if (body.byteLength < 1_000 || body.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("GIAS download response was not a valid bounded CSV/archive");
  }
  if (/text\/html/i.test(contentType) && !/\.csv|\.zip/i.test(finalUrl)) {
    throw new Error("GIAS download returned HTML instead of a downloadable file");
  }
  const extension = /zip/i.test(finalUrl) || /zip/i.test(contentType) ? "zip" : "csv";
  const path = datedFile(cacheDir, "gias-establishments", extension);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, body);
  if (extension === "zip") {
    const listing = await execFileAsync("unzip", ["-Z1", path], { maxBuffer: 1_000_000 });
    const csvEntry = listing.stdout.split(/\r?\n/).find((entry) => /\.csv$/i.test(entry));
    if (!csvEntry) throw new Error("GIAS archive did not contain a CSV file");
    const extractedPath = datedFile(cacheDir, "gias-establishments", "csv");
    const extracted = await execFileAsync("unzip", ["-p", path, csvEntry], { maxBuffer: MAX_SOURCE_BYTES });
    await writeFile(extractedPath, extracted.stdout);
    return { path: extractedPath, sourceUrl: GIAS_DOWNLOADS_PAGE };
  }
  if (!(await validGiasCsv(path))) throw new Error("GIAS response was not a recognizable CSV");
  return { path, sourceUrl: GIAS_DOWNLOADS_PAGE };
}

function nestedField(value: unknown, names: string[]): string {
  if (!value || typeof value !== "object") return "";
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, candidate] of entries) {
    if (wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
      (typeof candidate === "string" || typeof candidate === "number")) {
      return String(candidate).trim();
    }
  }
  for (const candidate of entries.map(([, item]) => item)) {
    const found = nestedField(candidate, names);
    if (found) return found;
  }
  return "";
}

function charityResults(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"));
  }
  if (!payload || typeof payload !== "object") return [];
  for (const value of Object.values(payload as Record<string, unknown>)) {
    const results = charityResults(value);
    if (results.length) return results;
  }
  return [];
}

async function discoverCharityApi(
  cacheDir: string,
  charityNames: readonly string[],
): Promise<SourceDownload> {
  const apiKey = process.env.CHARITY_COMMISSION_API_KEY;
  if (!apiKey) throw new Error("CHARITY_COMMISSION_API_KEY is not set");
  const baseUrl = (process.env.CHARITY_COMMISSION_API_BASE_URL || CHARITY_API_BASE).replace(/\/+$/, "");
  const cachedPath = datedFile(cacheDir, "charity-commission", "csv");
  if (await validCsvFile(cachedPath)) {
    sourceStatus("charity", "cached", cachedPath);
    return { path: cachedPath, sourceUrl: baseUrl };
  }

  const output: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  for (const name of [...new Set(charityNames.map((value) => value.trim()).filter(Boolean))]) {
    const searchUrl = `${baseUrl}/searchCharityName/${encodeURIComponent(name)}`;
    const searchResponse = await fetchWithBackoff(searchUrl, {
      headers: {
        "User-Agent": "JOBSAGE sponsor contact discovery/1.0",
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    }, "Charity Commission search", 30_000);
    const matches = charityResults(JSON.parse(await searchResponse.text())).slice(0, 3);
    for (const match of matches) {
      const number = nestedField(match, ["reg_charity_number", "registered_number", "registeredcharitynumber"]);
      if (!number || seen.has(number)) continue;
      seen.add(number);
      const suffix = nestedField(match, ["group_subsid_suffix", "subsidiary_number", "suffix"]) || "0";
      const detailsUrl = `${baseUrl}/charitydetails/${encodeURIComponent(number)}/${encodeURIComponent(suffix)}`;
      const contactUrl = `${baseUrl}/charitycontactinformation/${encodeURIComponent(number)}/${encodeURIComponent(suffix)}`;
      const [detailsResponse, contactResponse] = await Promise.all([
        fetchWithBackoff(detailsUrl, {
          headers: { "User-Agent": "JOBSAGE sponsor contact discovery/1.0", Accept: "application/json", "Ocp-Apim-Subscription-Key": apiKey },
        }, "Charity Commission details", 30_000),
        fetchWithBackoff(contactUrl, {
          headers: { "User-Agent": "JOBSAGE sponsor contact discovery/1.0", Accept: "application/json", "Ocp-Apim-Subscription-Key": apiKey },
        }, "Charity Commission contact", 30_000),
      ]);
      const details = JSON.parse(await detailsResponse.text());
      const contact = JSON.parse(await contactResponse.text());
      const charityName = nestedField(details, ["charity_name", "charityname", "name"]) ||
        nestedField(match, ["charity_name", "charityname", "name"]) || name;
      const website = nestedField(contact, ["website", "website_url", "web_address", "webaddress", "charity_website"]) ||
        nestedField(details, ["website", "website_url", "web_address", "webaddress", "charity_website"]);
      const email = nestedField(contact, ["email", "email_address", "emailaddress", "public_email", "publicemail"]);
      output.push({
        organisation_name: charityName,
        website,
        contact_email: email,
        evidence_url: `${CHARITY_REGISTER_BASE}/${number}`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!output.length) throw new Error("Charity Commission API returned no usable charity records");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachedPath, stringifyCsv(output, ["organisation_name", "website", "contact_email", "evidence_url"]));
  sourceStatus("charity", "downloaded", cachedPath);
  return { path: cachedPath, sourceUrl: baseUrl };
}

export async function acquireOfficialSources(options: {
  cacheDir: string;
  cqcPath?: string;
  giasPath?: string;
  charityPath?: string;
  charityNames?: readonly string[];
  noAutoFetch: boolean;
}): Promise<{
  cqcPath?: string;
  giasPath?: string;
  charityPath?: string;
  warnings: string[];
  sourceUrls: Record<string, string>;
}> {
  const warnings: string[] = [];
  const sourceUrls: Record<string, string> = {};
  const result: {
    cqcPath?: string;
    giasPath?: string;
    charityPath?: string;
  } = {};

  const provided = async (path: string | undefined, label: string): Promise<string | undefined> => {
    if (!path) return undefined;
    try {
      await readFile(path);
      return path;
    } catch {
      warnings.push(`${label}: supplied file not found at ${path}; attempting auto-fetch.`);
      return undefined;
    }
  };

  result.cqcPath = await provided(options.cqcPath, "cqc");
  result.giasPath = await provided(options.giasPath, "gias");
  result.charityPath = await provided(options.charityPath, "charity");
  if (options.noAutoFetch) {
    for (const [label, path] of [["cqc", result.cqcPath], ["gias", result.giasPath]] as const) {
      if (!path) warnings.push(`${label}: auto-fetch disabled and no usable file was supplied.`);
    }
    if (!result.charityPath) warnings.push("charity: auto-fetch disabled and no usable file was supplied.");
    return { ...result, warnings, sourceUrls };
  }

  if (!result.cqcPath) {
    try {
      const downloaded = await discoverCqc(options.cacheDir);
      result.cqcPath = downloaded.path;
      if (downloaded.sourceUrl) sourceUrls.cqc = downloaded.sourceUrl;
    } catch (error) {
      warnings.push(`cqc: auto-fetch failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!result.giasPath) {
    try {
      const downloaded = await discoverGias(options.cacheDir);
      result.giasPath = downloaded.path;
      if (downloaded.sourceUrl) sourceUrls.gias = downloaded.sourceUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sourceStatus("gias", "failed", message);
      warnings.push(`gias: auto-fetch failed — ${message}`);
    }
  }
  if (!result.charityPath) {
    if (process.env.CHARITY_COMMISSION_API_KEY) {
      try {
        const downloaded = await discoverCharityApi(options.cacheDir, options.charityNames ?? []);
        result.charityPath = downloaded.path;
        if (downloaded.sourceUrl) sourceUrls.charity = downloaded.sourceUrl;
      } catch (error) {
        warnings.push(`charity: API fetch failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      warnings.push("charity: skipped because CHARITY_COMMISSION_API_KEY is not set.");
    }
  }
  return { ...result, warnings, sourceUrls };
}