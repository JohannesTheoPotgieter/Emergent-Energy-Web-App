import { db } from "../db";
import { sql } from "drizzle-orm";

async function run() {
  await db.execute(sql`
    ALTER TABLE role_credentials
    ADD COLUMN IF NOT EXISTS password_last_changed_at TIMESTAMP DEFAULT NOW()
  `);

  await db.execute(sql`
    UPDATE role_credentials
    SET password_last_changed_at = COALESCE(password_last_changed_at, updated_at, NOW())
  `);

  await db.execute(sql`
    ALTER TABLE role_credentials
    DROP COLUMN IF EXISTS last_password_plain
  `);

  await db.execute(sql`
    ALTER TABLE role_credentials
    ALTER COLUMN password_last_changed_at SET NOT NULL
  `);

  console.log("[remove-last-password-plain] migration complete");
}

run().catch((err) => {
  console.error("[remove-last-password-plain] failed:", err);
  process.exit(1);
});
