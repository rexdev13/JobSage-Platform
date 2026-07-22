import { db, profilesTable } from "@workspace/db";
import { isNotNull, gt, and, asc } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { getObjectAclPolicy } from "./objectAcl";

const BATCH_SIZE = 50;

export async function runProfilePhotoAclBackfill(): Promise<void> {
  const objectStorageService = new ObjectStorageService();
  let lastId = 0;
  let stamped = 0;
  let skipped = 0;
  let missing = 0;
  let total = 0;

  console.log("[photo-acl-backfill] Checking for profile photos missing ACL metadata…");

  while (true) {
    const rows = await db
      .select({ id: profilesTable.id, userId: profilesTable.userId, profilePhotoKey: profilesTable.profilePhotoKey })
      .from(profilesTable)
      .where(and(isNotNull(profilesTable.profilePhotoKey), gt(profilesTable.id, lastId)))
      .orderBy(asc(profilesTable.id))
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.profilePhotoKey) continue;
      total++;
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(row.profilePhotoKey);
        const existingPolicy = await getObjectAclPolicy(objectFile);

        if (existingPolicy) {
          skipped++;
        } else {
          await objectStorageService.trySetObjectEntityAclPolicy(row.profilePhotoKey, {
            owner: row.userId,
            visibility: "private",
          });
          stamped++;
        }
      } catch (err) {
        if (err instanceof ObjectNotFoundError) {
          missing++;
        } else {
          console.error(`[photo-acl-backfill] Error on profile ${row.id}:`, err);
          skipped++;
        }
      }
    }

    lastId = rows[rows.length - 1]!.id;
  }

  if (total === 0) {
    console.log("[photo-acl-backfill] No profile photos found — skipping.");
    return;
  }

  console.log(
    `[photo-acl-backfill] Done — ${total} checked, ${stamped} ACLs written, ${skipped} already set, ${missing} missing from storage.`
  );
}
