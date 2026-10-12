import { DeletionBlocked } from "./engine";
import { DELETION_REQUESTS_ENABLED } from "./releaseReadiness";

/** Also guard direct adapter/store calls, not just routes and schedulers. */
export function requireDeletionRelease() {
  if (!DELETION_REQUESTS_ENABLED) throw new DeletionBlocked("deletion_release_blocked");
}
