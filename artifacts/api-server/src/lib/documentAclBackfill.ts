import { db, documentsTable } from "@workspace/db";
import { gt, asc } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

const BATCH_SIZE = 50;

export async function runDocumentAclBackfill(): Promise<void> {
  const objectStorageService = new ObjectStorageService();
  let lastId = 0;
  let stamped = 0;
  let skipped = 0;
  let missing = 0;
  let total = 0;

  console.log("[doc-acl-backfill] Checking for documents missing ACL metadata…");

  while (true) {
    const rows = await db
      .select({ id: documentsTable.id, userId: documentsTable.userId, storageKey: documentsTable.storageKey })
      .from(documentsTable)
      .where(gt(documentsTable.id, lastId))
      .orderBy(asc(documentsTable.id))
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      total++;
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(row.storageKey);
        const { getObjectAclPolicy } = await import("./objectAcl");
        const existingPolicy = await getObjectAclPolicy(objectFile);

        if (existingPolicy) {
          skipped++;
        } else {
          await objectStorageService.trySetObjectEntityAclPolicy(row.storageKey, {
            owner: row.userId,
            visibility: "private",
          });
          stamped++;
        }
      } catch (err) {
        if (err instanceof ObjectNotFoundError) {
          missing++;
        } else {
          console.error(`[doc-acl-backfill] Error on doc ${row.id}:`, err);
          skipped++;
        }
      }
    }

    lastId = rows[rows.length - 1]!.id;
  }

  if (total === 0) {
    console.log("[doc-acl-backfill] No documents found — skipping.");
    return;
  }

  console.log(
    `[doc-acl-backfill] Done — ${total} checked, ${stamped} ACLs written, ${skipped} already set, ${missing} missing from storage.`
  );
}
