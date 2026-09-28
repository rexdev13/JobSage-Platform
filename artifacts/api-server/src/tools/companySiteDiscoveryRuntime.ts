export type DiscoveryDatabaseMode = "development" | "production-readonly";
export type DiscoverySourceEnvironment = "development" | "production";

const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/i;
export const PRODUCTION_READONLY_DATABASE_ENV =
  "COMPANY_SITE_DISCOVERY_READONLY_DATABASE_URL";

export type PreparedDatabaseContext = {
  mode: DiscoveryDatabaseMode;
  sourceEnvironment: DiscoverySourceEnvironment;
  expectedFingerprint: string;
  nodeEnvironment: string;
  writesDisabled: boolean;
  /** Connection string is intentionally excluded from reports and logs. */
  databaseUrl: string;
};

export function validateInputDeclaration(
  sourceEnvironment: unknown,
  sourceDescription: unknown,
): { sourceEnvironment: DiscoverySourceEnvironment; sourceDescription: string } {
  if (sourceEnvironment !== "development" && sourceEnvironment !== "production") {
    throw new Error("Input must explicitly declare sourceEnvironment as development or production.");
  }
  if (typeof sourceDescription !== "string" || !sourceDescription.trim()) {
    throw new Error("Input must explicitly declare a non-empty sourceDescription.");
  }
  return {
    sourceEnvironment,
    sourceDescription: sourceDescription.trim(),
  };
}

function connectionTarget(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Database URL must be a valid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database URL must use the PostgreSQL protocol.");
  }
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || "5432"}${url.pathname}`;
}

export function assertInputSourceMatchesMode(
  mode: DiscoveryDatabaseMode,
  inputSourceEnvironment?: DiscoverySourceEnvironment,
): void {
  if (!inputSourceEnvironment) return;
  const expected = mode === "development" ? "development" : "production";
  if (inputSourceEnvironment !== expected) {
    throw new Error(
      `Input source ${inputSourceEnvironment} cannot be combined with ${mode} database state.`,
    );
  }
}

export function prepareDatabaseContext(
  args: ReadonlyMap<string, string>,
  env: NodeJS.ProcessEnv = process.env,
  inputSourceEnvironment?: DiscoverySourceEnvironment,
): PreparedDatabaseContext {
  if (args.has("environment")) {
    throw new Error("Use --db-mode; --environment is no longer accepted.");
  }
  const mode = args.get("db-mode");
  if (mode !== "development" && mode !== "production-readonly") {
    throw new Error("--db-mode must be development or production-readonly.");
  }
  assertInputSourceMatchesMode(mode, inputSourceEnvironment);

  const expectedFingerprint = args.get("expected-db-fingerprint");
  if (!expectedFingerprint || !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw new Error("--expected-db-fingerprint must be a confirmed 32-character hexadecimal fingerprint.");
  }

  if (mode === "development") {
    if (env.NODE_ENV !== "development") {
      throw new Error("Development database mode requires NODE_ENV=development.");
    }
    if (!env.DATABASE_URL) {
      throw new Error("Development database mode requires DATABASE_URL.");
    }
    return {
      mode,
      sourceEnvironment: "development",
      expectedFingerprint,
      nodeEnvironment: env.NODE_ENV,
      writesDisabled: false,
      databaseUrl: env.DATABASE_URL,
    };
  }

  if (env.NODE_ENV !== "production") {
    throw new Error("Production read-only database mode requires NODE_ENV=production.");
  }
  if (args.get("confirm-production-read-only") !== "true") {
    throw new Error("Production read-only mode requires --confirm-production-read-only=true.");
  }
  const productionUrl = env[PRODUCTION_READONLY_DATABASE_ENV]?.trim();
  if (!productionUrl) {
    throw new Error(
      `Production read-only mode requires the ${PRODUCTION_READONLY_DATABASE_ENV} secret.`,
    );
  }
  const defaultUrl = env.DATABASE_URL?.trim();
  if (!defaultUrl) {
    throw new Error("Production read-only mode requires the default DATABASE_URL for target separation checks.");
  }
  if (connectionTarget(productionUrl) === connectionTarget(defaultUrl)) {
    throw new Error("Production read-only URL resolves to the same database target as DATABASE_URL.");
  }

  return {
    mode,
    sourceEnvironment: "production",
    expectedFingerprint,
    nodeEnvironment: env.NODE_ENV,
    writesDisabled: true,
    databaseUrl: productionUrl,
  };
}

export function installDatabaseContext(
  context: PreparedDatabaseContext,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.DATABASE_URL = context.databaseUrl;
  if (context.mode === "production-readonly") {
    env.DATABASE_READ_ONLY = "true";
  } else {
    delete env.DATABASE_READ_ONLY;
  }
}

export function assertWritesAllowed(
  mode: DiscoveryDatabaseMode,
  writeRequested: boolean,
  operation: "mapping" | "vacancy",
): void {
  if (mode === "production-readonly" && writeRequested) {
    throw new Error(`Production read-only mode cannot write ${operation} data.`);
  }
}