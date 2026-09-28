import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { objectStorageClient } from "./objectStorage";

export type WorkflowReportKind = "discovery" | "dry-run" | "apply";
export type WorkflowReport = Record<string, unknown> & {
  reportId: string;
  reportKind: WorkflowReportKind;
  generatedAt: string;
};

const localRoot = join(process.cwd(), ".cache", "company-site-workflow");

function localPath(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid report ID.");
  return join(localRoot, `${id}.json`);
}

function productionPath(id: string): { bucket: string; object: string } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid report ID.");
  const configured = process.env.PRIVATE_OBJECT_DIR;
  if (!configured?.startsWith("/")) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  const parts = configured.split("/").filter(Boolean);
  const bucket = parts.shift();
  if (!bucket) throw new Error("PRIVATE_OBJECT_DIR has no bucket.");
  return { bucket, object: `${parts.join("/")}/company-site-workflow/reports/${id}.json` };
}

export async function saveWorkflowReport(
  reportKind: WorkflowReportKind,
  data: Record<string, unknown>,
): Promise<WorkflowReport> {
  const report = {
    ...data,
    reportId: randomUUID(),
    reportKind,
    generatedAt: new Date().toISOString(),
  } satisfies WorkflowReport;
  const content = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (process.env.NODE_ENV === "production") {
    const target = productionPath(report.reportId);
    await objectStorageClient.bucket(target.bucket).file(target.object).save(content, {
      contentType: "application/json",
      resumable: false,
      metadata: { cacheControl: "private, no-store" },
    });
  } else {
    await mkdir(localRoot, { recursive: true });
    await writeFile(localPath(report.reportId), content, { mode: 0o600 });
  }
  return report;
}

export async function loadWorkflowReport(reportId: string): Promise<WorkflowReport | null> {
  try {
    if (process.env.NODE_ENV === "production") {
      const target = productionPath(reportId);
      const [content] = await objectStorageClient.bucket(target.bucket).file(target.object).download();
      return JSON.parse(content.toString("utf8")) as WorkflowReport;
    }
    return JSON.parse((await readFile(localPath(reportId))).toString("utf8")) as WorkflowReport;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT" || code === "404") return null;
    throw error;
  }
}