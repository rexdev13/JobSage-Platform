export type DiscoveryDatabaseMode =
  | "development"
  | "production-readonly"
  | "production-proof-readonly";
export type DiscoverySourceEnvironment = "development" | "production";

const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/i;
export const PRODUCTION_READONLY_DATABASE_ENV =
  "COMPANY_SITE_DISCOVERY_READONLY_DATABASE_URL";
export const PRODUCTION_PROOF_DATABASE_ENV =
  "COMPANY_SITE_DISCOVERY_PROOF_DATABASE_URL";

export type DiscoveryExecutionOptions = {
  preflightOnly: boolean;
  limit: number;
  cooldownDays: number;
  format: "json" | "csv";
  noHostState: boolean;
  organisationNames?: string[];
  healthcareOnly?: boolean;
  savedCareersOnly?: boolean;
};

export type PreparedDatabaseContext = {
  mode: DiscoveryDatabaseMode;
  sourceEnvironment: DiscoverySourceEnvironment;
  expectedFingerprint?: string;
  nodeEnvironment: string;
  writesDisabled: boolean;
  /** Connection string is intentionally excluded from reports and logs. */
  databaseUrl: string;
};

export function parseDiscoveryExecutionOptions(
  args: ReadonlyMap<string, string>,
  limits: { defaultLimit: number; maxLimit: number; defaultCooldownDays?: number },
): DiscoveryExecutionOptions {
  const rawPreflight = args.get("preflight-only");
  if (rawPreflight !== undefined && rawPreflight !== "true" && rawPreflight !== "false") {
    throw new Error("--preflight-only must be true or false.");
  }
  const preflightOnly = rawPreflight === "true";
  const format = args.get("format") ?? "json";
  if (format !== "json" && format !== "csv") {
    throw new Error("--format must be json or csv");
  }

  const organisationNames = args.get("organisations")
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const noHostState = args.get("no-host-state") === "true";
  const cooldownDays = Number(args.get("cooldown-days") ?? limits.defaultCooldownDays ?? 14);
  if (!Number.isInteger(cooldownDays) || cooldownDays < 1 || cooldownDays > 365) {
    throw new Error("--cooldown-days must be an integer from 1 to 365.");
  }
  const parseBooleanFlag = (name: string): boolean => {
    const value = args.get(name);
    if (value !== undefined && value !== "true" && value !== "false") {
      throw new Error(`--${name} must be true or false.`);
    }
    return value === "true";
  };
  const healthcareOnly = parseBooleanFlag("healthcare-only");
  const savedCareersOnly = parseBooleanFlag("saved-careers-only");
  let limit: number;
  if (preflightOnly) {
    if (args.get("db-mode") !== "production-readonly") {
      throw new Error("--preflight-only requires --db-mode=production-readonly.");
    }
    if (args.has("limit") && args.get("limit") !== "0") {
      throw new Error("--preflight-only requires --limit=0.");
    }
    if (args.has("input-file") || args.has("organisations")) {
      throw new Error("--preflight-only cannot load employer input or select employers.");
    }
    if (format !== "json") {
      throw new Error("--preflight-only requires --format=json.");
    }
    limit = 0;
  } else {
    limit = Number(args.get("limit") ?? limits.defaultLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > limits.maxLimit) {
      throw new Error(`--limit must be an integer from 1 to ${limits.maxLimit}`);
    }
    if (args.has("input-file") && !args.get("input-file")?.trim()) {
      throw new Error("--input-file requires a path.");
    }
    if (organisationNames && (
      organisationNames.length > 10 ||
      new Set(organisationNames.map((name) => name.toLowerCase())).size !== organisationNames.length
    )) {
      throw new Error("--organisations accepts up to 10 distinct, comma-separated exact employer names.");
    }
  }
  if (args.get("db-mode") === "production-proof-readonly") {
    if (args.has("input-file") || args.has("organisations")) {
      throw new Error("Production proof mode selects employers from the production database only.");
    }
    if (format !== "json") {
      throw new Error("Production proof mode requires --format=json.");
    }
    if (!noHostState) {
      throw new Error("Production proof mode requires --no-host-state=true.");
    }
  }

  return {
    preflightOnly,
    limit,
    cooldownDays,
    format,
    noHostState,
    ...(args.has("healthcare-only") ? { healthcareOnly } : {}),
    ...(args.has("saved-careers-only") ? { savedCareersOnly } : {}),
    ...(organisationNames ? { organisationNames } : {}),
  };
}

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
  if (
    mode !== "development" &&
    mode !== "production-readonly" &&
    mode !== "production-proof-readonly"
  ) {
    throw new Error("--db-mode must be development, production-readonly, or production-proof-readonly.");
  }
  assertInputSourceMatchesMode(mode, inputSourceEnvironment);

  const expectedFingerprint = args.get("expected-db-fingerprint");
  if (
    (mode !== "production-proof-readonly" && !expectedFingerprint) ||
    (expectedFingerprint && !FINGERPRINT_PATTERN.test(expectedFingerprint))
  ) {
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
    throw new Error("Production database modes require NODE_ENV=production.");
  }

  if (mode === "production-readonly") {
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

  if (args.get("confirm-production-proof-readonly") !== "true") {
    throw new Error("Production proof mode requires --confirm-production-proof-readonly=true.");
  }
  const proofUrl = env[PRODUCTION_PROOF_DATABASE_ENV]?.trim();
  if (!proofUrl) {
    throw new Error(
      `Production proof mode requires the ${PRODUCTION_PROOF_DATABASE_ENV} secret.`,
    );
  }
  return {
    mode,
    sourceEnvironment: "production",
    ...(expectedFingerprint ? { expectedFingerprint } : {}),
    nodeEnvironment: env.NODE_ENV,
    writesDisabled: true,
    databaseUrl: proofUrl,
  };
}

export function installDatabaseContext(
  context: PreparedDatabaseContext,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.DATABASE_URL = context.databaseUrl;
  if (context.mode !== "development") {
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
  if (mode !== "development" && writeRequested) {
    throw new Error(`Production read-only mode cannot write ${operation} data.`);
  }
}

export function verifyProductionWriteGuards(
  mode: DiscoveryDatabaseMode,
): { mappingWritesBlocked: boolean; vacancyWritesBlocked: boolean } {
  const isBlocked = (operation: "mapping" | "vacancy"): boolean => {
    try {
      assertWritesAllowed(mode, true, operation);
      return false;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `Production read-only mode cannot write ${operation} data.`
      ) {
        return true;
      }
      throw error;
    }
  };
  return {
    mappingWritesBlocked: isBlocked("mapping"),
    vacancyWritesBlocked: isBlocked("vacancy"),
  };
}