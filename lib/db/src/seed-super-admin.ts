import "dotenv/config";
import { db, usersTable } from "./index";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx seed-super-admin.ts <email>");
    process.exit(1);
  }

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  await db
    .update(usersTable)
    .set({ role: "super_admin" })
    .where(eq(usersTable.id, user.id));

  console.log(`✓ Promoted ${user.email} (was: ${user.role}) → super_admin`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
