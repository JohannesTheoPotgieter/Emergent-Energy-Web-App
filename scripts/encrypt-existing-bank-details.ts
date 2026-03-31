/**
 * Phase 2: Encrypt existing plaintext bank details in the counterparties table.
 *
 * Reads all counterparty rows, detects already-encrypted vs plaintext values,
 * encrypts only plaintext values, and logs totals.
 *
 * Run with: npx tsx scripts/encrypt-existing-bank-details.ts
 *
 * IMPORTANT: Ensure TOKEN_ENCRYPTION_KEY is set in .env before running.
 * Never log decrypted or plaintext bank values.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { encryptField, isFieldEncrypted } from "../server/lib/field-encryption";

async function main() {
  console.log("[encrypt-bank-details] Starting encryption of existing bank details...");

  const result = await db.execute(sql`
    SELECT id, bank_account_number, bank_branch_code
    FROM counterparties
  `);
  const rows = (result as any).rows || [];

  let scanned = 0;
  let migrated = 0;
  let alreadyEncrypted = 0;
  let skippedNull = 0;
  let failed = 0;

  for (const row of rows) {
    scanned++;
    const id = row.id as number;
    let accountEncrypted = false;
    let branchEncrypted = false;

    // Process bank_account_number
    const account = row.bank_account_number as string | null;
    if (account === null || account === "") {
      skippedNull++;
    } else if (isFieldEncrypted(account)) {
      alreadyEncrypted++;
      accountEncrypted = true;
    } else {
      try {
        const encrypted = encryptField(account);
        await db.execute(sql`
          UPDATE counterparties SET bank_account_number = ${encrypted} WHERE id = ${id}
        `);
        accountEncrypted = true;
      } catch (err: any) {
        failed++;
        console.error(`[encrypt-bank-details] Failed to encrypt bank_account_number for id=${id}: ${err.message}`);
      }
    }

    // Process bank_branch_code
    const branch = row.bank_branch_code as string | null;
    if (branch === null || branch === "") {
      // counted in null tracking above only for account
    } else if (isFieldEncrypted(branch)) {
      // already counted
    } else {
      try {
        const encrypted = encryptField(branch);
        await db.execute(sql`
          UPDATE counterparties SET bank_branch_code = ${encrypted} WHERE id = ${id}
        `);
      } catch (err: any) {
        failed++;
        console.error(`[encrypt-bank-details] Failed to encrypt bank_branch_code for id=${id}: ${err.message}`);
      }
    }

    if (accountEncrypted || (account === null || account === "")) {
      migrated++;
    }
  }

  console.log("[encrypt-bank-details] Complete.");
  console.log(`  Scanned:           ${scanned}`);
  console.log(`  Migrated:          ${migrated}`);
  console.log(`  Already encrypted: ${alreadyEncrypted}`);
  console.log(`  Skipped (null):    ${skippedNull}`);
  console.log(`  Failed:            ${failed}`);

  if (failed > 0) {
    console.error(`[encrypt-bank-details] WARNING: ${failed} rows failed to encrypt. Review errors above.`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[encrypt-bank-details] Fatal error:", err.message);
  process.exit(1);
});
