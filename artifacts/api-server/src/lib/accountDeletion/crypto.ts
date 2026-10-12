import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";

/** Domain separation: stable pseudonyms must not share encryption keys or plain SHA hashes.
 * Key rotation requires migration of unfinished tasks and the independent tombstone registry. */
function secret() {
  const value = process.env.ACCOUNT_DELETION_MASTER_KEY;
  if (!value || value.length < 32) throw new Error("deletion_key_not_configured");
  return value;
}
export function accountDeletionHash(accountId: string) {
  return createHmac("sha256", secret()).update("jobsage-account-deletion\0").update(accountId).digest("hex");
}
export function encryptDeletionResource(value: string) {
  const iv = randomBytes(12);
  const key = scryptSync(secret(), "jobsage-deletion-operational-v1", 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), bytes.toString("base64")].join(".");
}
export function decryptDeletionResource(value: string) {
  const [version, iv, tag, bytes] = value.split(".");
  if (version !== "v1" || !iv || !tag || !bytes) throw new Error("deletion_resource_invalid");
  const key = scryptSync(secret(), "jobsage-deletion-operational-v1", 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(bytes, "base64")), decipher.final()]).toString("utf8");
}
