import { describe, expect, it } from "vitest";
import {
  assertInputSourceMatchesMode,
  assertWritesAllowed,
  installDatabaseContext,
  parseDiscoveryExecutionOptions,
  prepareDatabaseContext,
  validateInputDeclaration,
  verifyProductionWriteGuards,
} from "../../tools/companySiteDiscoveryRuntime";

const fingerprint = "a".repeat(32);

describe("company-site discovery database context", () => {
  it("requires an explicit mode and independently confirmed fingerprint", () => {
    expect(() => prepareDatabaseContext(new Map(), {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://dev-db/jobsage",
    })).toThrow("--db-mode");

    expect(() => prepareDatabaseContext(new Map([
      ["db-mode", "development"],
    ]), {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://dev-db/jobsage",
    })).toThrow("--expected-db-fingerprint");
  });

  it("keeps development input and state in development mode", () => {
    const context = prepareDatabaseContext(new Map([
      ["db-mode", "development"],
      ["expected-db-fingerprint", fingerprint],
    ]), {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://dev-db/jobsage",
    }, "development");

    expect(context).toMatchObject({
      mode: "development",
      sourceEnvironment: "development",
      expectedFingerprint: fingerprint,
      writesDisabled: false,
    });
    expect(() => prepareDatabaseContext(new Map([
      ["db-mode", "development"],
      ["expected-db-fingerprint", fingerprint],
    ]), {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://prod-db/jobsage",
    })).toThrow("NODE_ENV=development");
  });

  it("requires a separate production read-only connection and refuses the default target", () => {
    const args = new Map([
      ["db-mode", "production-readonly"],
      ["expected-db-fingerprint", fingerprint],
      ["confirm-production-read-only", "true"],
    ]);
    const env = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://dev-db/jobsage",
    };
    expect(() => prepareDatabaseContext(args, env)).toThrow(
      "COMPANY_SITE_DISCOVERY_READONLY_DATABASE_URL",
    );
    expect(() => prepareDatabaseContext(args, {
      ...env,
      COMPANY_SITE_DISCOVERY_READONLY_DATABASE_URL: "postgresql://dev-db/jobsage",
    })).toThrow("same database target");

    const context = prepareDatabaseContext(args, {
      ...env,
      COMPANY_SITE_DISCOVERY_READONLY_DATABASE_URL: "postgresql://readonly@prod-db/jobsage",
    }, "production");
    expect(context).toMatchObject({
      mode: "production-readonly",
      sourceEnvironment: "production",
      writesDisabled: true,
    });
    const installed: NodeJS.ProcessEnv = { ...env };
    installDatabaseContext(context, installed);
    expect(installed.DATABASE_URL).toBe("postgresql://readonly@prod-db/jobsage");
    expect(installed.DATABASE_READ_ONLY).toBe("true");
  });

  it("rejects cross-environment employer input and requires its source declaration", () => {
    expect(() => assertInputSourceMatchesMode("production-readonly", "development"))
      .toThrow("cannot be combined");
    expect(() => assertInputSourceMatchesMode("development", "production"))
      .toThrow("cannot be combined");
    expect(validateInputDeclaration("production", "production read-only export"))
      .toEqual({
        sourceEnvironment: "production",
        sourceDescription: "production read-only export",
      });
    expect(() => validateInputDeclaration("production", "  ")).toThrow(
      "sourceDescription",
    );
  });

  it("blocks production mapping and vacancy writes", () => {
    expect(() => assertWritesAllowed("production-readonly", true, "mapping"))
      .toThrow("cannot write mapping");
    expect(() => assertWritesAllowed("production-readonly", true, "vacancy"))
      .toThrow("cannot write vacancy");
    expect(() => assertWritesAllowed("production-readonly", false, "mapping")).not.toThrow();
    expect(() => assertWritesAllowed("development", true, "mapping")).not.toThrow();
  });

  it("allows only a zero-employer production JSON preflight", () => {
    const options = parseDiscoveryExecutionOptions(new Map([
      ["db-mode", "production-readonly"],
      ["preflight-only", "true"],
      ["limit", "0"],
    ]), { defaultLimit: 10, maxLimit: 25 });
    expect(options).toEqual({
      preflightOnly: true,
      limit: 0,
      format: "json",
      noHostState: false,
    });
    expect(verifyProductionWriteGuards("production-readonly")).toEqual({
      mappingWritesBlocked: true,
      vacancyWritesBlocked: true,
    });
    expect(verifyProductionWriteGuards("development")).toEqual({
      mappingWritesBlocked: false,
      vacancyWritesBlocked: false,
    });
  });

  it("rejects employer selection, discovery, and CSV options in preflight mode", () => {
    const base = [
      ["db-mode", "production-readonly"],
      ["preflight-only", "true"],
      ["limit", "0"],
    ] as const;
    for (const extra of [
      ["input-file", "employers.json"],
      ["organisations", "Example Ltd"],
      ["format", "csv"],
      ["limit", "5"],
      ["db-mode", "development"],
    ] as const) {
      const args = new Map<string, string>(base);
      args.set(extra[0], extra[1]);
      expect(() => parseDiscoveryExecutionOptions(args, {
        defaultLimit: 10,
        maxLimit: 25,
      })).toThrow();
    }
    expect(() => parseDiscoveryExecutionOptions(new Map([
      ["preflight-only", "sometimes"],
    ]), { defaultLimit: 10, maxLimit: 25 })).toThrow("--preflight-only must be true or false");
  });
});