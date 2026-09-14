import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const CQC_DATA_PAGE = "https://www.cqc.org.uk/about-us/transparency/using-cqc-data";
const GIAS_DOWNLOADS_PAGE = "https://get-information-schools.service.gov.uk/Downloads";
const MAX_SOURCE_BYTES = 120 * 1024 * 1024;
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

async function discoverGias(cacheDir: string): Promise<SourceDownload> {
  try {
    const cached = (await readdir(cacheDir))
      .filter((name) => /^gias-establishments-\d{4}-\d{2}-\d{2}\.csv$/.test(name))
      .sort()
      .reverse();
    for (const name of cached) {
      const path = join(cacheDir, name);
      const sample = (await readFile(path)).subarray(0, 512).toString("utf8");
      if (!/<html|<!doctype/i.test(sample) && /establishment|urn|school/i.test(sample)) {
        return { path, sourceUrl: GIAS_DOWNLOADS_PAGE };
      }
    }
  } catch {
    // Cache directory may not exist yet.
  }
  const pageResponse = await fetch(GIAS_DOWNLOADS_PAGE, {
    headers: { "User-Agent": "JOBSAGE sponsor contact discovery/1.0", Accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!pageResponse.ok) throw new Error(`GIAS page HTTP ${pageResponse.status}`);
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

  const cookieHeader = pageResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
  const post = await fetch(new URL("/Downloads/Collate", GIAS_DOWNLOADS_PAGE), {
    method: "POST",
    headers: {
      "User-Agent": "JOBSAGE sponsor contact discovery/1.0",
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: form,
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!post.ok) throw new Error(`GIAS download request HTTP ${post.status}`);
  let body = Buffer.from(await post.arrayBuffer());
  let finalUrl = post.url;
  let contentType = post.headers.get("content-type") ?? "";
  if (/text\/html/i.test(contentType) && /\/Downloads\/Generated\//i.test(finalUrl)) {
    const generatedIndex = finalUrl.toLowerCase().indexOf("/generated/");
    const generatedId = finalUrl.slice(generatedIndex + "/generated/".length).split("?")[0];
    const pollingUrl = new URL(`/Downloads/GenerateAjax/${generatedId}`, GIAS_DOWNLOADS_PAGE);
    let completed = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const poll = await fetch(pollingUrl, {
        headers: {
          "User-Agent": "JOBSAGE sponsor contact discovery/1.0",
          Accept: "application/json",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!poll.ok) throw new Error(`GIAS generation polling HTTP ${poll.status}`);
      const raw = await poll.text();
      const parsed = JSON.parse(raw);
      const status = typeof parsed === "string" ? JSON.parse(parsed) : parsed as { status?: boolean; redirect?: string };
      if (status.status && status.redirect) {
        const generatedPageUrl = new URL(status.redirect, GIAS_DOWNLOADS_PAGE);
        const generatedPage = await fetch(generatedPageUrl, {
          headers: {
            "User-Agent": "JOBSAGE sponsor contact discovery/1.0",
            Accept: "text/html",
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!generatedPage.ok) throw new Error(`GIAS generated page HTTP ${generatedPage.status}`);
        const generatedHtml = await generatedPage.text();
        const extractAction = generatedHtml.match(/<form\b[^>]*action=["']([^"']*\/Downloads\/Download\/Extract)["']/i)?.[1];
        const extractFields = hiddenInputs(generatedHtml);
        if (!extractAction || !extractFields.id || !extractFields.path) {
          throw new Error("GIAS generated page did not expose its protected download form");
        }
        const extractForm = new URLSearchParams();
        for (const [key, value] of Object.entries(extractFields)) extractForm.set(key, value);
        const extracted = await fetch(new URL(extractAction, GIAS_DOWNLOADS_PAGE), {
          method: "POST",
          headers: {
            "User-Agent": "JOBSAGE sponsor contact discovery/1.0",
            Accept: "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
          body: extractForm,
          redirect: "follow",
          signal: AbortSignal.timeout(120_000),
        });
        if (!extracted.ok) throw new Error(`GIAS file extraction HTTP ${extracted.status}`);
        body = Buffer.from(await extracted.arrayBuffer());
        finalUrl = extracted.url;
        contentType = extracted.headers.get("content-type") ?? "";
        completed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (!completed) throw new Error("GIAS CSV generation timed out");
  }
  if (body.byteLength < 1000 || body.byteLength > MAX_SOURCE_BYTES) {
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
    return { path: extractedPath, sourceUrl: GIAS_DOWNLOADS_PAGE };
  }
  return { path, sourceUrl: GIAS_DOWNLOADS_PAGE };
}

export async function acquireOfficialSources(options: {
  cacheDir: string;
  cqcPath?: string;
  giasPath?: string;
  charityPath?: string;
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
      warnings.push(`gias: auto-fetch failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!result.charityPath) {
    if (process.env.CHARITY_COMMISSION_API_KEY) {
      warnings.push("charity: API key is set, but no stable bulk endpoint is configured; skipped safely.");
    } else {
      warnings.push("charity: skipped because CHARITY_COMMISSION_API_KEY is not set.");
    }
  }
  return { ...result, warnings, sourceUrls };
}