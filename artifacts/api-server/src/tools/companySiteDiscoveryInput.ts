import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import {
  validateInputDeclaration,
  type DiscoverySourceEnvironment,
} from "./companySiteDiscoveryRuntime";

export type EmployerRow = {
  organisation_name: string;
  website: string;
  industry?: string | null;
  careers_url: string | null;
  operator_evidence_urls: string[];
  ats_provider: string | null;
  ats_board_id: string | null;
  ats_mapping_status: string | null;
  ats_mapping_evidence_url: string | null;
};

export type LoadedEmployerInput = {
  sourceEnvironment: DiscoverySourceEnvironment;
  sourceDescription: string;
  employers: EmployerRow[];
  path: string;
  sha256: string;
};

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function operatorEvidenceUrls(value: unknown, index: number): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(";").map((url) => url.trim()).filter(Boolean)
      : [];
  if (values.length > 5) {
    throw new Error(`Employer input row ${index + 1} may contain at most five operator_evidence_urls.`);
  }
  const urls: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Employer input row ${index + 1} contains an invalid operator evidence URL.`);
    }
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new Error(`Employer input row ${index + 1} contains an invalid operator evidence URL.`);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      throw new Error(`Employer input row ${index + 1} operator evidence URLs must be public HTTPS URLs without credentials or custom ports.`);
    }
    url.search = "";
    url.hash = "";
    const canonical = url.toString();
    if (!urls.includes(canonical)) urls.push(canonical);
  }
  return urls;
}

function employerFromInput(value: unknown, index: number): EmployerRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Employer input row ${index + 1} must be an object.`);
  }
  const row = value as Record<string, unknown>;
  const organisationName = optionalText(row.organisation_name ?? row.organisationName);
  const website = optionalText(row.website);
  if (!organisationName || !website) {
    throw new Error(`Employer input row ${index + 1} requires organisation_name and website.`);
  }
  return {
    organisation_name: organisationName,
    website,
    industry: optionalText(row.industry),
    careers_url: optionalText(row.careers_url ?? row.careersUrl),
    operator_evidence_urls: operatorEvidenceUrls(
      row.operator_evidence_urls ?? row.operatorEvidenceUrls,
      index,
    ),
    ats_provider: optionalText(row.ats_provider ?? row.atsProvider),
    ats_board_id: optionalText(row.ats_board_id ?? row.atsBoardId),
    ats_mapping_status: optionalText(row.ats_mapping_status ?? row.atsMappingStatus),
    ats_mapping_evidence_url: optionalText(
      row.ats_mapping_evidence_url ?? row.atsMappingEvidenceUrl,
    ),
  };
}

export async function loadEmployerInput(filePath: string): Promise<LoadedEmployerInput> {
  const path = await realpath(resolve(filePath));
  const content = await readFile(path);
  if (content.byteLength > 5_000_000) {
    throw new Error("--input-file may not exceed 5 MB.");
  }
  const text = content.toString("utf8");
  const extension = extname(path).toLowerCase();
  let sourceEnvironment: unknown;
  let sourceDescription: unknown;
  let employers: unknown;
  if (extension === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("--input-file JSON is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("--input-file JSON must be an object.");
    }
    const envelope = parsed as Record<string, unknown>;
    sourceEnvironment = envelope.sourceEnvironment;
    sourceDescription = envelope.sourceDescription;
    employers = envelope.employers;
  } else if (extension === ".csv") {
    let rows: Array<Record<string, string>>;
    try {
      rows = parseCsv(text, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
      }) as Array<Record<string, string>>;
    } catch {
      throw new Error("--input-file CSV is invalid.");
    }
    if (rows.length === 0) throw new Error("--input-file CSV must contain at least one employer row.");
    sourceEnvironment = rows[0]?.source_environment;
    sourceDescription = rows[0]?.source_description;
    if (rows.some((row) =>
      row.source_environment !== sourceEnvironment ||
      row.source_description !== sourceDescription
    )) {
      throw new Error("Every CSV row must declare the same source_environment and source_description.");
    }
    employers = rows;
  } else {
    throw new Error("--input-file must have a .json or .csv extension.");
  }

  const declaration = validateInputDeclaration(sourceEnvironment, sourceDescription);
  if (!Array.isArray(employers) || employers.length === 0 || employers.length > 500) {
    throw new Error("Input employers must contain between 1 and 500 rows.");
  }
  return {
    ...declaration,
    employers: employers.map(employerFromInput),
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}