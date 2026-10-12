import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ObjectStorageService } from "../objectStorage";
import { getObjectAclPolicy } from "../objectAcl";
import { createPrivateArchive, ExportUnavailable, MAX_EXPORT_BYTES, type ExportEntry } from "./archive";
import { readBoundedExportRows, readPersonalRecords } from "./records";

async function readOwnedFile(path: string, userId: string, remaining: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(storage.normalizeObjectEntityPath(path));
  const [metadata] = await file.getMetadata();
  const generation = String(metadata.generation ?? "");
  if (!/^[0-9]+$/.test(generation)) throw new ExportUnavailable("An uploaded file version could not be verified.");
  // Bind ownership, headers and bytes to one immutable generation, not a mutable object name.
  const pinnedFile = file.bucket.file(file.name, { generation });
  const acl = await getObjectAclPolicy(pinnedFile);
  signal.throwIfAborted();
  if (acl?.owner !== userId || !await storage.canAccessObjectEntity({ objectFile: pinnedFile, userId })) throw new ExportUnavailable("An uploaded file could not be verified for this account. Request a full export from the privacy team.");
  const response = await storage.downloadObject(pinnedFile, 0);
  if (signal.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
  if (!response.ok || !response.body) throw new ExportUnavailable("An uploaded file is unavailable. No incomplete archive has been delivered.");
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > remaining) {
    await response.body.cancel();
    throw new ExportUnavailable("Uploaded files exceed the immediate-export limit.");
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > remaining) throw new ExportUnavailable("Uploaded files exceed the 12 MB immediate-export limit. Request a full export from the privacy team.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

/** Bytes stay in memory and are delivered directly; no public URL, export cache, or email attachment. */
async function collectArchive(userId: string, readFile: typeof readOwnedFile, signal: AbortSignal): Promise<Buffer> {
  const snapshot = await db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10000ms'`);
    const budget = { remaining: MAX_EXPORT_BYTES - 65_536 };
    const records = await readPersonalRecords(tx, userId, signal, budget);
    const documents = await readBoundedExportRows(tx, sql`SELECT id, filename, mime_type, storage_key, file_size, document_type, label, is_primary, parsed_data, uploaded_at FROM documents WHERE user_id = ${userId} LIMIT 5001`, budget, signal);
    const identities = await readBoundedExportRows(tx, sql`SELECT id, passport_key, selfie_key FROM identity_verifications WHERE user_id = ${userId} LIMIT 5001`, budget, signal);
    const photos = await readBoundedExportRows(tx, sql`SELECT profile_photo_key FROM profiles WHERE user_id = ${userId} LIMIT 5001`, budget, signal);
    signal.throwIfAborted();
    const letters = await readBoundedExportRows(tx, sql`SELECT author_name, author_title, organisation, relationship, content, is_employer_verified, created_at
      FROM recommendation_letters WHERE candidate_user_id = ${userId} OR employer_user_id = ${userId} LIMIT 5001`, budget, signal);
    const replies = await readBoundedExportRows(tx, sql`SELECT r.admin_display_name, r.reply_text, r.created_at FROM support_ticket_replies r
      JOIN support_tickets t ON t.id = r.ticket_id WHERE t.user_id = ${userId} AND r.delivery_status = 'sent' LIMIT 5001`, budget, signal);
    records.recommendation_letters = letters;
    records.support_replies = replies;
    return { records, documents, identities, photos };
  });
  const entries: ExportEntry[] = [];
  const documents = snapshot.documents.map(row => {
    const { storage_key: _key, ...metadata } = row;
    const ext = String(row.filename).match(/\.[a-z0-9]{1,8}$/i)?.[0].toLowerCase() ?? ".bin";
    return { ...metadata, archive_file: `documents/document-${row.id}${ext}` };
  });
  entries.push({ name: "account-records.json", bytes: Buffer.from(JSON.stringify({
    format: "jobsage-personal-data-v1", generatedAt: new Date().toISOString(), records: snapshot.records, documents,
    coverage: {
      included: ["Saved account records listed in records", "Uploaded document originals", "Identity-verification originals", "Professional-profile photo"],
      excluded: ["Passwords, authentication/reset/OAuth credentials, push tokens", "Internal staff notes and other accounts' private records", "Independent employer/ATS copies, processor-only records, backups and restricted legal/security records"],
      fullAccessRequest: "Use the authenticated privacy support-request option for records outside this immediate archive or if the archive exceeds 12 MB. This file is not a declaration that no other personal data is held.",
    },
  }, null, 2)) });
  let size = entries[0].bytes.length;
  if (size > MAX_EXPORT_BYTES) throw new ExportUnavailable("Account records exceed the immediate-export limit. Request a full export from the privacy team.");
  const addFile = async (path: unknown, name: string) => {
    signal.throwIfAborted();
    if (typeof path !== "string" || !path) throw new ExportUnavailable("An uploaded file reference is missing. No incomplete archive has been delivered.");
    const bytes = await readFile(path, userId, MAX_EXPORT_BYTES - size, signal);
    signal.throwIfAborted();
    size += bytes.length;
    if (size > MAX_EXPORT_BYTES) throw new ExportUnavailable("The archive exceeds the immediate-export limit.");
    entries.push({ name, bytes });
  };
  for (let i = 0; i < snapshot.documents.length; i++) await addFile(snapshot.documents[i].storage_key, documents[i].archive_file);
  for (const row of snapshot.identities) {
    if (row.passport_key) await addFile(row.passport_key, `identity/passport-${row.id}.bin`);
    if (row.selfie_key) await addFile(row.selfie_key, `identity/selfie-${row.id}.bin`);
  }
  for (let i = 0; i < snapshot.photos.length; i++) if (snapshot.photos[i].profile_photo_key) await addFile(snapshot.photos[i].profile_photo_key, `profile/photo-${i}.bin`);
  return createPrivateArchive(entries);
}

export async function buildPersonalDataArchive(userId: string, readFile = readOwnedFile): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new ExportUnavailable("The export timed out. No incomplete archive was delivered. Try again or request a full export.")), 45_000);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  try { return await Promise.race([collectArchive(userId, readFile, controller.signal), aborted]); }
  finally { clearTimeout(timeout); }
}
