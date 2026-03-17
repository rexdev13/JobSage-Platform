import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { decisionRecordsTable, consentLogsTable } from "@workspace/db";
import { desc, gte, lte, and, count } from "drizzle-orm";
import { requireAdmin } from "./rulesets";
import { createHash } from "crypto";

const router: IRouter = Router();

function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

router.get("/admin/audit/decisions", requireAdmin, async (req, res): Promise<void> => {
  const { format = "json", from, to } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      conditions.push(gte(decisionRecordsTable.createdAt, fromDate));
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      conditions.push(lte(decisionRecordsTable.createdAt, toDate));
    }
  }

  const records =
    conditions.length > 1
      ? await db
          .select()
          .from(decisionRecordsTable)
          .where(and(...conditions))
          .orderBy(desc(decisionRecordsTable.createdAt))
      : conditions.length === 1
        ? await db
            .select()
            .from(decisionRecordsTable)
            .where(conditions[0])
            .orderBy(desc(decisionRecordsTable.createdAt))
        : await db
            .select()
            .from(decisionRecordsTable)
            .orderBy(desc(decisionRecordsTable.createdAt));

  const anonymised = records.map((r) => ({
    userIdHash: hashUserId(r.userId),
    createdAt: r.createdAt,
    rulesetVersion: r.rulesetVersion,
    outcome: r.outcome,
    reasonCodes: r.reasonCodes,
  }));

  if (format === "csv") {
    const header = "userIdHash,createdAt,rulesetVersion,outcome,reasonCodes";
    const rows = anonymised.map(
      (r) =>
        `${r.userIdHash},${r.createdAt.toISOString()},${r.rulesetVersion},${r.outcome},"${r.reasonCodes.join("|")}"`
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=decisions-audit.csv");
    res.send([header, ...rows].join("\n"));
    return;
  }

  res.json({
    records: anonymised,
    total: anonymised.length,
    exportedAt: new Date(),
  });
});

router.get("/admin/audit/consents", requireAdmin, async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) ?? "50", 10)));
  const offset = (page - 1) * pageSize;

  const [totalResult] = await db.select({ count: count() }).from(consentLogsTable);
  const total = Number(totalResult?.count ?? 0);

  const entries = await db
    .select()
    .from(consentLogsTable)
    .orderBy(desc(consentLogsTable.consentedAt))
    .limit(pageSize)
    .offset(offset);

  res.json({
    entries: entries.map((e) => ({
      userId: e.userId,
      consentedAt: e.consentedAt,
      termsVersion: e.termsVersion,
    })),
    total,
    page,
    pageSize,
  });
});

export default router;
