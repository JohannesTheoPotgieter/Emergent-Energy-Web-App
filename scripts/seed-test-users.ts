/**
 * Seed the minimal set of users that the CI quality-gate (test:api +
 * release:gate) logs in as. Without these rows the password-login path in
 * `server/routes/auth-routes.ts` returns 401 and every API test fails at
 * `loginAdmin()`.
 *
 * Run as part of CI after `npm run db:push` / `db:migrate`. Idempotent —
 * skips users that already exist (by username).
 *
 * Run with: npx tsx scripts/seed-test-users.ts
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db, initializeDatabase } from "../server/db";
import { users } from "@shared/schema";

type SeedUser = {
  username: string;
  email: string;
  name: string;
  role: string;
  password: string;
};

const TEST_USERS: SeedUser[] = [
  {
    username: "johannes",
    email: "johannes@emergent.energy",
    name: "Johannes Potgieter",
    role: "COO_ADMIN",
    password: "2023",
  },
  {
    username: "eon",
    email: "eon@emergent.energy",
    name: "Eon Van Rensburg",
    role: "PROJECT_MANAGER_SITE",
    password: "2035",
  },
  {
    username: "opsmanager31",
    email: "opsmanager31@emergent.energy",
    name: "Restricted Ops Manager",
    role: "PROJECT_MANAGER_SITE",
    password: "2035",
  },
  {
    username: "task110_target",
    email: "task110_target@example.test",
    name: "Task110 Target",
    role: "PROJECT_MANAGER_SITE",
    password: "Active110!",
  },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-test-users.ts refuses to run in production");
  }

  await initializeDatabase();

  let inserted = 0;
  let skipped = 0;
  for (const user of TEST_USERS) {
    const existing = await db.select().from(users).where(eq(users.username, user.username));
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    const passwordHash = await bcrypt.hash(user.password, 12);
    await db.insert(users).values({
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      password: passwordHash,
    });
    inserted++;
  }

  console.log(`[seed-test-users] inserted=${inserted} skipped=${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-test-users] failed:", err);
    process.exit(1);
  });
