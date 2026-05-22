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
import { eq, sql } from "drizzle-orm";

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
    username: "paul",
    email: "paul@emergent.energy",
    name: "Paul Test Engineer",
    role: "ENGINEER",
    password: "2029",
  },
  {
    username: "dean",
    email: "dean@emergent.energy",
    name: "Dean Test Quality Manager",
    role: "QUALITY_MANAGER",
    password: "2025",
  },
  {
    username: "dayne",
    email: "dayne@emergent.energy",
    name: "Dayne Test Admin",
    role: "COO_ADMIN",
    password: "TestPassword123!",
  },
];

export async function seedTestUsers() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-test-users.ts refuses to run in production");
  }

  await initializeDatabase();

  let inserted = 0;
  let updated = 0;
  for (const user of TEST_USERS) {
    const existing = await db.select().from(users).where(eq(users.username, user.username));
    const passwordHash = await bcrypt.hash(user.password, 12);
    if (existing.length > 0) {
      await db
        .update(users)
        .set({
          email: user.email,
          name: user.name,
          role: user.role,
          password: passwordHash,
          isActive: true,
          deletedAt: null,
        } as any)
        .where(eq(users.username, user.username));
      updated++;
      continue;
    }
    await db.insert(users).values({
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      password: passwordHash,
    });
    inserted++;
  }

  await db.execute(sql.raw(`
    UPDATE users
    SET username = lower(username)
    WHERE username IS NOT NULL
  `)).catch(() => {});

  console.log(`[seed-test-users] inserted=${inserted} updated=${updated}`);
}

async function main() {
  await seedTestUsers();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-test-users] failed:", err);
    process.exit(1);
  });
