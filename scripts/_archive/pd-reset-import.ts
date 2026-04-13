/**
 * PD Reset & Import — Production-ready migration script
 *
 * Clears all existing PD tickets + linked work-items, then inserts 11
 * baseline records from PD_latest.xlsm.
 *
 * Usage:
 *   npx tsx scripts/pd-reset-import.ts              # execute migration
 *   npx tsx scripts/pd-reset-import.ts --dry-run     # preview only, no mutations
 *
 * Prerequisites:
 *   - DATABASE_URL must be set in environment
 *
 * Features:
 *   - Transaction-wrapped: all-or-nothing (rollback on any failure)
 *   - Backup: exports existing PD data to backups/ before deleting
 *   - Dry-run mode: shows what would happen without mutating
 *   - Idempotent: safe to run multiple times
 *   - Environment-aware: uses DATABASE_URL from env
 */

import { sql, eq, isNotNull, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as fs from "fs";
import * as path from "path";

// ─── CLI flags ────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");

// ─── source data (11 records) ─────────────────────────────────────

interface SourceRecord {
  projectSiteName: string;
  dueDate: string;
  requestType: string;
  priority: string;
  status: string;
  numberOfReworks: number;
  projectDeveloper: string;
  designer: string;
  sizeKwp: string | null;
  province: string;
  gpsCoordinates: string;
  fundingType: string;
  billsOrTariffData: boolean;
  meteringDataAvailable: boolean;
  siteInspectionForm: boolean;
  siteInspectionLink: string | null;
  workingSchedule: string;
  batteriesNeeded: boolean;
  batterySize: string | null;
  dieselGenIntegration: boolean;
  roofReplacementNeeded: boolean;
  hseDiscussed: boolean;
  comments: string;
  clickUpSynced: boolean;
}

const SOURCE_DATA: SourceRecord[] = [
  {
    projectSiteName: "Trident Steel BESS consumption analysis",
    dueDate: "2026-03-12",
    requestType: "Data Analysis Request",
    priority: "Normal",
    status: "In progress",
    numberOfReworks: 0,
    projectDeveloper: "",
    designer: "Tanaka Zimuto",
    sizeKwp: null,
    province: "",
    gpsCoordinates: "",
    fundingType: "Instalment Sales Agreement;#PPA",
    billsOrTariffData: true,
    meteringDataAvailable: true,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 8am - 17pm",
    batteriesNeeded: true,
    batterySize: null,
    dieselGenIntegration: true,
    roofReplacementNeeded: false,
    hseDiscussed: false,
    comments: "We need to assess the side of an upgrade for JHB to obtain greater arbitrage",
    clickUpSynced: true,
  },
  {
    projectSiteName: "National Ships Chandler",
    dueDate: "2026-03-17",
    requestType: "Meter installation",
    priority: "Normal",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Gordon Upton",
    designer: "Tanaka Zimuto",
    sizeKwp: null,
    province: "Eastern Cape",
    gpsCoordinates: "",
    fundingType: "Instalment Sales Agreement;#PPA",
    billsOrTariffData: false,
    meteringDataAvailable: false,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 24/7",
    batteriesNeeded: false,
    batterySize: null,
    dieselGenIntegration: false,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "National Ship Chandlers, Kiel Street, Coega. Meeting with Lloyd first.",
    clickUpSynced: true,
  },
  {
    projectSiteName: "NatShips",
    dueDate: "2026-03-19",
    requestType: "Meter installation",
    priority: "URGENT",
    status: "In progress",
    numberOfReworks: 0,
    projectDeveloper: "Gordon Upton",
    designer: "Tanaka Zimuto",
    sizeKwp: null,
    province: "Eastern Cape",
    gpsCoordinates: "",
    fundingType: "Instalment Sales Agreement;#Self Funded",
    billsOrTariffData: false,
    meteringDataAvailable: false,
    siteInspectionForm: true,
    siteInspectionLink: "loaded",
    workingSchedule: "Monday - Sunday, 24/7",
    batteriesNeeded: true,
    batterySize: null,
    dieselGenIntegration: false,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "We need to swop the Smappy with the meter which has just arrived from CT.",
    clickUpSynced: true,
  },
  {
    projectSiteName: "Mayo Macs Paddock Site Visit",
    dueDate: "2026-03-20",
    requestType: "Site visit Report",
    priority: "High",
    status: "New",
    numberOfReworks: 2,
    projectDeveloper: "Megan Moore",
    designer: "Roedolph Venter",
    sizeKwp: "480",
    province: "KZN",
    gpsCoordinates: "N2 Main Harding Rd, Paddock Plains, KZN",
    fundingType: "Instalment Sales Agreement",
    billsOrTariffData: true,
    meteringDataAvailable: true,
    siteInspectionForm: true,
    siteInspectionLink: "not loaded",
    workingSchedule: "Monday - Sunday, 24/7",
    batteriesNeeded: true,
    batterySize: "1200",
    dieselGenIntegration: true,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "",
    clickUpSynced: true,
  },
  {
    projectSiteName: "WERDA",
    dueDate: "2026-03-20",
    requestType: "Meter installation",
    priority: "Normal",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Cole Bisset",
    designer: "Tanaka Zimuto",
    sizeKwp: "250",
    province: "Western Cape",
    gpsCoordinates: "-33.99066364589065, 20.181539820747506",
    fundingType: "Bank Debt",
    billsOrTariffData: true,
    meteringDataAvailable: false,
    siteInspectionForm: true,
    siteInspectionLink: "not loaded",
    workingSchedule: "Monday - Sunday, 8am - 17pm",
    batteriesNeeded: true,
    batterySize: "400",
    dieselGenIntegration: true,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "Fluke meter install - Fedgroup Funding Deal. Please confirm with me so I can notify client",
    clickUpSynced: true,
  },
  {
    projectSiteName: "Sandown/Atlantic Corner",
    dueDate: "2026-03-23",
    requestType: "CP - PVSOL",
    priority: "High",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Cole Bisset",
    designer: "Tanaka Zimuto",
    sizeKwp: "500",
    province: "Western Cape",
    gpsCoordinates: "",
    fundingType: "PPA",
    billsOrTariffData: true,
    meteringDataAvailable: false,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 8am - 17pm",
    batteriesNeeded: false,
    batterySize: "0",
    dieselGenIntegration: false,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "Please use 330W panels in this design. The panels are roughly 7 years old.",
    clickUpSynced: true,
  },
  {
    projectSiteName: "Constantia Glen",
    dueDate: "2026-03-24",
    requestType: "Site visit Report",
    priority: "Normal",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Cole Bisset",
    designer: "Paul Dreyer",
    sizeKwp: "100",
    province: "Western Cape",
    gpsCoordinates: "-34.0147, 18.4146",
    fundingType: "Self Funded;#Bank Debt",
    billsOrTariffData: true,
    meteringDataAvailable: false,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 8am - 17pm",
    batteriesNeeded: true,
    batterySize: "100",
    dieselGenIntegration: true,
    roofReplacementNeeded: false,
    hseDiscussed: false,
    comments: "Arbitrage for restaurant",
    clickUpSynced: true,
  },
  {
    projectSiteName: "Altix Holdings Medical Centre & Garage",
    dueDate: "2026-03-24",
    requestType: "First Assessment - PowerPoint Template",
    priority: "Normal",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Kirsten Marwick",
    designer: "Mary Boakye",
    sizeKwp: null,
    province: "KZN",
    gpsCoordinates: "-29.7287, 31.0689",
    fundingType: "Self Funded;#Instalment Sales Agreement",
    billsOrTariffData: true,
    meteringDataAvailable: true,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 24/7",
    batteriesNeeded: true,
    batterySize: "20",
    dieselGenIntegration: false,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "",
    clickUpSynced: true,
  },
  {
    projectSiteName: "Somerset Square",
    dueDate: "2026-03-25",
    requestType: "Site visit Report",
    priority: "URGENT",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Megan Moore",
    designer: "Paul Dreyer",
    sizeKwp: "150",
    province: "Western Cape",
    gpsCoordinates: "-33.91287875756561, 18.41624193907976",
    fundingType: "Self Funded",
    billsOrTariffData: true,
    meteringDataAvailable: true,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 8am - 17pm",
    batteriesNeeded: false,
    batterySize: "0",
    dieselGenIntegration: true,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "",
    clickUpSynced: true,
  },
  {
    projectSiteName: "Commercial Centre",
    dueDate: "2026-03-26",
    requestType: "First Assessment - PowerPoint Template",
    priority: "Normal",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Gordon Upton",
    designer: "Tanaka Zimuto",
    sizeKwp: "100",
    province: "Eastern Cape",
    gpsCoordinates: "",
    fundingType: "Self Funded;#Instalment Sales Agreement",
    billsOrTariffData: true,
    meteringDataAvailable: true,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 8am - 17pm",
    batteriesNeeded: true,
    batterySize: "100",
    dieselGenIntegration: false,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "Need to confirm metering data.",
    clickUpSynced: true,
  },
  {
    projectSiteName: "Steelcorp - Moore St & Lamp Road",
    dueDate: "2026-03-27",
    requestType: "Sizing Rational Request",
    priority: "High",
    status: "New",
    numberOfReworks: 0,
    projectDeveloper: "Kirsten Marwick",
    designer: "Tanaka Zimuto",
    sizeKwp: null,
    province: "Gauteng",
    gpsCoordinates: "",
    fundingType: "Self Funded;#Instalment Sales Agreement",
    billsOrTariffData: true,
    meteringDataAvailable: true,
    siteInspectionForm: false,
    siteInspectionLink: null,
    workingSchedule: "Monday - Sunday, 24/7",
    batteriesNeeded: true,
    batterySize: "20",
    dieselGenIntegration: true,
    roofReplacementNeeded: false,
    hseDiscussed: true,
    comments: "",
    clickUpSynced: true,
  },
];

// ─── helpers ──────────────────────────────────────────────────────

function parsePeopleName(raw: string): string {
  if (!raw) return "";
  return raw.split(";#")[0].trim();
}

function esc(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ─── main ─────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  PD Reset & Import${DRY_RUN ? "  [DRY RUN]" : ""}`);
  console.log(`${"=".repeat(60)}\n`);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  // ── Step 1: Resolve users ──
  console.log("1. Resolving user names...");
  const userRows = (await db.execute(sql`SELECT id, name, username FROM users ORDER BY name`)).rows as any[];
  console.log(`   Found ${userRows.length} users in database`);

  function resolveUser(name: string): number | null {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    for (const u of userRows) {
      if (u.username?.toLowerCase() === n || u.name?.toLowerCase() === n) return u.id;
    }
    for (const u of userRows) {
      const first = (u.name || "").split(" ")[0].toLowerCase();
      if (first === n) return u.id;
    }
    for (const u of userRows) {
      if ((u.name || "").toLowerCase().includes(n) || n.includes((u.name || "").toLowerCase())) return u.id;
    }
    return null;
  }

  const uniqueNames = new Set<string>();
  for (const r of SOURCE_DATA) {
    if (r.projectDeveloper) uniqueNames.add(parsePeopleName(r.projectDeveloper));
    if (r.designer) uniqueNames.add(parsePeopleName(r.designer));
  }

  const nameToId: Record<string, number | null> = {};
  const warnings: string[] = [];
  for (const name of uniqueNames) {
    const id = resolveUser(name);
    nameToId[name] = id;
    if (id === null) {
      warnings.push(`   WARNING: User "${name}" not found in database`);
    } else {
      console.log(`   Resolved: ${name} -> user ID ${id}`);
    }
  }
  for (const w of warnings) console.warn(w);

  // ── Step 2: Count existing data ──
  console.log("\n2. Counting existing PD data...");
  const ticketCount = Number((await db.execute(sql`SELECT count(*) as cnt FROM pd_tickets`)).rows[0]?.cnt ?? 0);
  const workItemCount = Number((await db.execute(sql`SELECT count(*) as cnt FROM work_items WHERE pd_ticket_id IS NOT NULL`)).rows[0]?.cnt ?? 0);
  console.log(`   pd_tickets:   ${ticketCount} records`);
  console.log(`   work_items:   ${workItemCount} records (linked to PD tickets)`);

  // ── Step 3: Backup existing data ──
  if (ticketCount > 0 || workItemCount > 0) {
    console.log("\n3. Backing up existing PD data...");
    const existingTickets = (await db.execute(sql`SELECT * FROM pd_tickets`)).rows;
    const existingWorkItems = (await db.execute(sql`SELECT * FROM work_items WHERE pd_ticket_id IS NOT NULL`)).rows;

    const backup = {
      exportedAt: new Date().toISOString(),
      pdTickets: existingTickets,
      linkedWorkItems: existingWorkItems,
    };

    const backupDir = path.join(process.cwd(), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupFile = path.join(backupDir, `pd-backup-${timestamp}.json`);

    if (!DRY_RUN) {
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), "utf-8");
      console.log(`   Backup saved: ${backupFile}`);
    } else {
      console.log(`   [DRY RUN] Would save backup to: ${backupFile}`);
    }
  } else {
    console.log("\n3. No existing PD data to backup.");
  }

  // ── Step 4: Show plan ──
  console.log("\n4. Migration plan:");
  console.log(`   DELETE: ${workItemCount} work_items (pd_ticket_id IS NOT NULL)`);
  console.log(`   DELETE: ${ticketCount} pd_tickets`);
  console.log(`   INSERT: ${SOURCE_DATA.length} new pd_tickets`);
  console.log("");

  if (DRY_RUN) {
    console.log("   [DRY RUN] Showing records that would be inserted:\n");
    for (let i = 0; i < SOURCE_DATA.length; i++) {
      const r = SOURCE_DATA[i];
      const devName = parsePeopleName(r.projectDeveloper);
      const designerName = parsePeopleName(r.designer);
      console.log(`   Record ${i + 1}: ${r.projectSiteName}`);
      console.log(`     Request Type: ${r.requestType} | Priority: ${r.priority} | Status: ${r.status}`);
      console.log(`     Developer: ${devName || "(none)"} -> ID ${devName ? nameToId[devName] ?? "NULL" : "NULL"}`);
      console.log(`     Designer: ${designerName || "(none)"} -> ID ${designerName ? nameToId[designerName] ?? "NULL" : "NULL"}`);
      console.log(`     Due: ${r.dueDate} | Size: ${r.sizeKwp ?? "NULL"} kWp | Province: ${r.province || "NULL"}`);
    }
    console.log(`\n   [DRY RUN] No changes made. Run without --dry-run to execute.\n`);
    await pool.end();
    return;
  }

  // ── Step 5: Execute in transaction ──
  console.log("5. Executing migration (transaction-wrapped)...");

  await db.transaction(async (tx) => {
    // Delete child records first
    const wiResult = await tx.execute(sql`DELETE FROM work_items WHERE pd_ticket_id IS NOT NULL`);
    console.log(`   Deleted work_items with pd_ticket_id`);

    // Delete PD tickets
    const ptResult = await tx.execute(sql`DELETE FROM pd_tickets`);
    console.log(`   Deleted all pd_tickets`);

    // Insert 11 records
    let inserted = 0;
    for (const r of SOURCE_DATA) {
      const devName = parsePeopleName(r.projectDeveloper);
      const designerName = parsePeopleName(r.designer);
      const devId = devName ? nameToId[devName] ?? null : null;
      const desId = designerName ? nameToId[designerName] ?? null : null;

      await tx.execute(sql`
        INSERT INTO pd_tickets (
          project_site_name, client_name_snapshot, due_date, request_type,
          priority, status, number_of_reworks,
          project_developer_user_id, designer_user_id,
          funding_type, size_kwp, province, gps_coordinates,
          bills_or_tariff_data, metering_data_available,
          site_inspection_form, site_inspection_link,
          working_schedule, batteries_needed, battery_size,
          diesel_gen_integration, roof_replacement_needed, hse_discussed,
          comments, clickup_synced,
          created_at, updated_at
        ) VALUES (
          ${r.projectSiteName}, ${r.projectSiteName}, ${r.dueDate}, ${r.requestType},
          ${r.priority}, ${r.status}, ${r.numberOfReworks},
          ${devId}, ${desId},
          ${r.fundingType}, ${r.sizeKwp}, ${r.province || null}, ${r.gpsCoordinates || null},
          ${r.billsOrTariffData}, ${r.meteringDataAvailable},
          ${r.siteInspectionForm}, ${r.siteInspectionLink},
          ${r.workingSchedule}, ${r.batteriesNeeded}, ${r.batterySize},
          ${r.dieselGenIntegration}, ${r.roofReplacementNeeded}, ${r.hseDiscussed},
          ${r.comments || null}, ${r.clickUpSynced},
          NOW(), NOW()
        )
      `);
      inserted++;
    }
    console.log(`   Inserted ${inserted} pd_tickets`);
  });

  // ── Step 6: Verify ──
  console.log("\n6. Verification...");
  const finalCount = Number((await db.execute(sql`SELECT count(*) as cnt FROM pd_tickets`)).rows[0]?.cnt ?? 0);
  const orphanedWI = Number((await db.execute(sql`SELECT count(*) as cnt FROM work_items WHERE pd_ticket_id IS NOT NULL`)).rows[0]?.cnt ?? 0);

  console.log(`   pd_tickets count: ${finalCount} (expected: 11)`);
  console.log(`   orphaned work_items: ${orphanedWI} (expected: 0)`);

  if (finalCount !== 11) {
    console.error("\n   VERIFICATION FAILED: wrong ticket count!");
    await pool.end();
    process.exit(1);
  }

  // Spot check records 1, 4, 7, 11
  console.log("\n   Spot checking records 1, 4, 7, 11...");
  const spotChecks = [
    { name: "Trident Steel BESS consumption analysis", idx: 1 },
    { name: "Mayo Macs Paddock Site Visit", idx: 4 },
    { name: "Constantia Glen", idx: 7 },
    { name: "Steelcorp - Moore St & Lamp Road", idx: 11 },
  ];
  for (const sc of spotChecks) {
    const row = (await db.execute(sql`SELECT * FROM pd_tickets WHERE project_site_name = ${sc.name}`)).rows[0] as any;
    if (!row) {
      console.error(`   FAILED: Record ${sc.idx} (${sc.name}) not found!`);
    } else {
      console.log(`   Record ${sc.idx}: ${row.project_site_name} | ${row.request_type} | ${row.priority} | ${row.status} | dev=${row.project_developer_user_id ?? "NULL"} | designer=${row.designer_user_id ?? "NULL"}`);
    }
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("  MIGRATION COMPLETE");
  console.log(`${"=".repeat(60)}`);
  console.log(`  PD tickets deleted:    ${ticketCount}`);
  console.log(`  Work items deleted:    ${workItemCount}`);
  console.log(`  PD tickets inserted:   ${finalCount}`);
  if (warnings.length > 0) {
    console.log(`  Warnings:              ${warnings.length}`);
    for (const w of warnings) console.log(`  ${w.trim()}`);
  }
  console.log("");

  await pool.end();
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err.message);
  console.error("Transaction rolled back — no changes were made.");
  process.exit(1);
});
