import { DeletionBlocked, type DeletionExecutor, type DeletionTask } from "./engine";
import { parseCleanupResource, type CleanupResource } from "./resource";
export type { CleanupResource } from "./resource";
/** Production adapters must be real provider/storage operations, not optimistic queue acknowledgements.
 * Independent employer/ATS copies must NEVER be represented as controlled processor jobs. */
export interface CleanupAdapters {
  revokeTokens(resource: CleanupResource, idempotencyKey: string): Promise<void>;
  eraseActiveData(resource: CleanupResource, idempotencyKey: string): Promise<void>;
  eraseObject(resource: CleanupResource, idempotencyKey: string): Promise<void>;
  eraseProcessor(resource: CleanupResource, idempotencyKey: string): Promise<"erased" | "dispatched" | "unsupported">;
  clearDeviceData(resource: CleanupResource, idempotencyKey: string): Promise<void>;
  sendCompletion(resource: CleanupResource, idempotencyKey: string): Promise<void>;
}

export class AccountDeletionExecutor implements DeletionExecutor {
  constructor(private adapters: CleanupAdapters) {}
  async run(task: DeletionTask) {
    const resource = parseCleanupResource(task.resource);
    if (!resource) throw new DeletionBlocked("resource_invalid");
    switch (task.kind) {
      case "token_revocation": await this.adapters.revokeTokens(resource, task.id); break;
      case "active_data": await this.adapters.eraseActiveData(resource, task.id); break;
      case "object": await this.adapters.eraseObject(resource, task.id); break;
      case "processor": {
        const status = await this.adapters.eraseProcessor(resource, task.id);
        // Dispatching is required, but not evidence that provider deletion has finished.
        if (status === "dispatched") throw new DeletionBlocked("provider_confirmation_pending");
        if (status !== "erased") throw new DeletionBlocked("provider_erasure_unsupported");
        break;
      }
      case "device_data": await this.adapters.clearDeviceData(resource, task.id); break;
      case "completion_notice": await this.adapters.sendCompletion(resource, task.id); break;
      default: throw new DeletionBlocked("task_kind_unsupported");
    }
  }
}
