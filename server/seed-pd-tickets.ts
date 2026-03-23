/**
 * PD Ticket Data Import — March 2026 baseline
 *
 * Clears all existing PD tickets + linked work-items, then inserts 11
 * records from the PD_latest.xlsm "query" sheet.
 *
 * Runs once (flag file prevents re-execution).  Designed to execute at
 * app startup via `runPdTicketSeed()`.
 */

import { db } from "./db";
import { pdTickets } from "@shared/schema/projects";
import { workItems } from "@shared/schema/tasks";
import { users } from "@shared/schema/users";
import { sql, eq, isNotNull, asc } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const DONE_FLAG = path.join(process.cwd(), "server", ".pd-seed-done");

// ─── helpers ──────────────────────────────────────────────────────

async function resolveUser(name: string): Promise<number | null> {
  if (!name) return null;
  const allUsers = await db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .orderBy(asc(users.name));
  const n = name.trim().toLowerCase();
  for (const u of allUsers) {
    if (u.username.toLowerCase() === n || u.name.toLowerCase() === n) return u.id;
  }
  for (const u of allUsers) {
    const first = u.name.split(" ")[0].toLowerCase();
    if (first === n) return u.id;
  }
  for (const u of allUsers) {
    if (u.name.toLowerCase().includes(n) || n.includes(u.name.toLowerCase())) return u.id;
  }
  return null;
}

/** Parse SharePoint people field "Name;#ID" — returns first name only */
function parsePeopleName(raw: string): string {
  if (!raw) return "";
  return raw.split(";#")[0].trim();
}

// ─── source records ───────────────────────────────────────────────

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
    sizeKwp: null, // TBC
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
    sizeKwp: null, // TBC
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

// ─── main seed function ───────────────────────────────────────────

export async function runPdTicketSeed() {
  if (fs.existsSync(DONE_FLAG)) {
    console.log("[PD-Seed] Already completed, skipping");
    return;
  }

  console.log("[PD-Seed] Starting PD ticket import…");

  // ── Step 1: resolve all unique user names ──
  const uniqueNames = new Set<string>();
  for (const r of SOURCE_DATA) {
    if (r.projectDeveloper) uniqueNames.add(parsePeopleName(r.projectDeveloper));
    if (r.designer) uniqueNames.add(parsePeopleName(r.designer));
  }

  const nameToId: Record<string, number | null> = {};
  const unresolvedNames: string[] = [];
  for (const name of uniqueNames) {
    const id = await resolveUser(name);
    nameToId[name] = id;
    if (id === null) unresolvedNames.push(name);
  }

  if (unresolvedNames.length > 0) {
    console.warn(`[PD-Seed] WARNING: Could not resolve users: ${unresolvedNames.join(", ")}`);
    console.warn("[PD-Seed] These records will have NULL user references. Continuing import…");
  } else {
    console.log(`[PD-Seed] All ${uniqueNames.size} users resolved successfully`);
  }

  // ── Step 2: clear existing PD data ──
  // Delete work-items linked to PD tickets first
  try {
    await db
      .delete(workItems)
      .where(isNotNull(workItems.pdTicketId));
    console.log(`[PD-Seed] Deleted work_items with pd_ticket_id`);
  } catch (err: any) {
    console.log(`[PD-Seed] Skipped work_items cleanup: ${err.message}`);
  }

  // Delete all PD tickets
  const deletedTickets = await db.delete(pdTickets);
  console.log(`[PD-Seed] Deleted all pd_tickets`);

  // ── Step 3: insert 11 records ──
  let inserted = 0;
  for (const r of SOURCE_DATA) {
    const devName = parsePeopleName(r.projectDeveloper);
    const designerName = parsePeopleName(r.designer);

    await db.insert(pdTickets).values({
      projectSiteName: r.projectSiteName,
      clientNameSnapshot: r.projectSiteName,
      dueDate: r.dueDate,
      requestType: r.requestType,
      priority: r.priority,
      status: r.status,
      numberOfReworks: r.numberOfReworks,
      projectDeveloperUserId: devName ? nameToId[devName] ?? null : null,
      designerUserId: designerName ? nameToId[designerName] ?? null : null,
      fundingType: r.fundingType,
      sizeKwp: r.sizeKwp,
      province: r.province || null,
      gpsCoordinates: r.gpsCoordinates || null,
      billsOrTariffData: r.billsOrTariffData,
      meteringDataAvailable: r.meteringDataAvailable,
      siteInspectionForm: r.siteInspectionForm,
      siteInspectionLink: r.siteInspectionLink,
      workingSchedule: r.workingSchedule,
      batteriesNeeded: r.batteriesNeeded,
      batterySize: r.batterySize,
      dieselGenIntegration: r.dieselGenIntegration,
      roofReplacementNeeded: r.roofReplacementNeeded,
      hseDiscussed: r.hseDiscussed,
      comments: r.comments || null,
      clickUpSynced: r.clickUpSynced,
    });
    inserted++;
  }

  console.log(`[PD-Seed] Inserted ${inserted} PD tickets`);

  // ── Step 4: verify ──
  const countResult = await db.select({ cnt: sql<number>`count(*)` }).from(pdTickets);
  const count = Number(countResult[0]?.cnt ?? 0);
  if (count !== 11) {
    console.error(`[PD-Seed] VERIFICATION FAILED: expected 11 tickets, found ${count}`);
    return;
  }
  console.log(`[PD-Seed] Verification passed: ${count} PD tickets in database`);

  // Write flag to prevent re-execution
  fs.mkdirSync(path.dirname(DONE_FLAG), { recursive: true });
  fs.writeFileSync(DONE_FLAG, "v1", "utf-8");
  console.log("[PD-Seed] Done ✓");
}
