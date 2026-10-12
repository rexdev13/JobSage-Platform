import { DeletionBlocked } from "./engine";

interface RegistryConfiguration {
  appBucket: string;
  registryBucket: string;
  publicSearchPaths?: string;
  privateObjectDir?: string;
}

/** Separation includes application serving/upload paths, not just the default
 * bucket. The public-file route does not enforce private object metadata. */
export function validateRegistryConfiguration(config: RegistryConfiguration) {
  const { appBucket, registryBucket } = config;
  if (!appBucket || !registryBucket || appBucket === registryBucket
    || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(registryBucket)) {
    throw new DeletionBlocked("independent_registry_not_configured");
  }
  const paths = [
    ...(config.publicSearchPaths ?? "").split(","),
    config.privateObjectDir ?? "",
  ];
  for (const path of paths) {
    const bucket = path.trim().replace(/^gs:\/\//, "").replace(/^\/+/, "").split("/")[0];
    if (bucket === registryBucket) throw new DeletionBlocked("registry_in_application_storage_paths");
  }
  return { appBucket, registryBucket };
}

export function configuredRegistryBuckets() {
  return validateRegistryConfiguration({
    appBucket: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "",
    registryBucket: process.env.ACCOUNT_DELETION_TOMBSTONE_BUCKET_ID ?? "",
    publicSearchPaths: process.env.PUBLIC_OBJECT_SEARCH_PATHS,
    privateObjectDir: process.env.PRIVATE_OBJECT_DIR,
  });
}
