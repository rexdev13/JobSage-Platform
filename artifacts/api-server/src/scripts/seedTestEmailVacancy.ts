/**
 * Seed the deterministic records used to prove live Send CV delivery.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run seed:test-email-vacancy
 *   pnpm --filter @workspace/api-server run seed:test-email-vacancy -- --candidate-email candidate@example.com
 */
import {
  seedTestEmailVacancy,
  TEST_EMAIL_APPLY_URL,
  TEST_EMAIL_ORGANISATION_NAME,
  TEST_EMAIL_RECIPIENT,
} from "../lib/testEmailVacancySeed";

function readArgument(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(`--${name}`);
  const next = index >= 0 ? process.argv[index + 1] : null;
  return next?.trim() || null;
}

async function main(): Promise<void> {
  const candidateUserId = readArgument("candidate-user-id");
  const candidateEmail = readArgument("candidate-email");
  const result = await seedTestEmailVacancy({ candidateUserId, candidateEmail });

  console.log("Send CV proof seed ready.");
  console.log(`  sponsorLicenceId: ${result.sponsorLicenceId}`);
  console.log(`  roleId: ${result.roleId}`);
  console.log(`  organisation: ${TEST_EMAIL_ORGANISATION_NAME}`);
  console.log("  location: London, UK");
  console.log("  regulator: NMC");
  console.log(`  contactEmail: ${TEST_EMAIL_RECIPIENT}`);
  console.log(`  applyUrl: ${TEST_EMAIL_APPLY_URL}`);
  console.log("  liveness: live");
  console.log(
    result.candidateUserId
      ? `  candidate score: 100 persisted for candidate ${result.candidateUserId}`
      : "  candidate score: not seeded (pass --candidate-email or --candidate-user-id for deterministic top ranking)",
  );
}

main().catch((error: unknown) => {
  console.error("Send CV proof seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});