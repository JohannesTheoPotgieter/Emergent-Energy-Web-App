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
import { pdTickets, clients, projectInfo } from "@shared/schema/projects";
import { users } from "@shared/schema/users";
import { sql, asc, eq, ilike, count } from "drizzle-orm";
import bcrypt from "bcryptjs";

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
  clientName: string;
  dueDate: string;
  requestType: string;
  priority: string;
  status: string;
  numberOfReworks: number;
  projectDeveloper: string;
  designerRole: "ENGINEER" | "PROJECT_DEVELOPER";
  developerRole: "PROJECT_DEVELOPER" | "ENGINEER";
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
    clientName: "Trident Steel",
    dueDate: "2026-03-12",
    requestType: "Data Analysis Request",
    priority: "Medium",
    status: "In Progress",
    numberOfReworks: 0,
    projectDeveloper: "",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Tanaka Zimuto",
    designerRole: "ENGINEER",
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
    clientName: "National Ships Chandler",
    dueDate: "2026-03-17",
    requestType: "Meter installation",
    priority: "Medium",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Gordon Upton",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Tanaka Zimuto",
    designerRole: "ENGINEER",
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
    clientName: "National Ships Chandler",
    dueDate: "2026-03-19",
    requestType: "Meter installation",
    priority: "Critical",
    status: "In Progress",
    numberOfReworks: 0,
    projectDeveloper: "Gordon Upton",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Tanaka Zimuto",
    designerRole: "ENGINEER",
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
    clientName: "Mayo Macs",
    dueDate: "2026-03-20",
    requestType: "Site visit Report",
    priority: "High",
    status: "Draft",
    numberOfReworks: 2,
    projectDeveloper: "Megan Moore",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Roedolph Venter",
    designerRole: "ENGINEER",
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
    clientName: "WERDA",
    dueDate: "2026-03-20",
    requestType: "Meter installation",
    priority: "Medium",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Cole Bisset",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Tanaka Zimuto",
    designerRole: "ENGINEER",
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
    clientName: "Sandown/Atlantic Corner",
    dueDate: "2026-03-23",
    requestType: "CP - PVSOL",
    priority: "High",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Cole Bisset",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Tanaka Zimuto",
    designerRole: "ENGINEER",
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
    clientName: "Constantia Glen",
    dueDate: "2026-03-24",
    requestType: "Site visit Report",
    priority: "Medium",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Cole Bisset",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Paul Dreyer",
    designerRole: "ENGINEER",
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
    clientName: "Altix Holdings",
    dueDate: "2026-03-24",
    requestType: "First Assessment - PowerPoint Template",
    priority: "Medium",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Kirsten Marwick",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Mary Boakye",
    designerRole: "ENGINEER",
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
    clientName: "Somerset Square",
    dueDate: "2026-03-25",
    requestType: "Site visit Report",
    priority: "Critical",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Megan Moore",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Paul Dreyer",
    designerRole: "ENGINEER",
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
    clientName: "Commercial Centre",
    dueDate: "2026-03-26",
    requestType: "First Assessment - PowerPoint Template",
    priority: "Medium",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Gordon Upton",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Tanaka Zimuto",
    designerRole: "ENGINEER",
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
    clientName: "Steelcorp",
    dueDate: "2026-03-27",
    requestType: "Sizing Rational Request",
    priority: "High",
    status: "Draft",
    numberOfReworks: 0,
    projectDeveloper: "Kirsten Marwick",
    developerRole: "PROJECT_DEVELOPER",
    designer: "Tanaka Zimuto",
    designerRole: "ENGINEER",
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
  // Check if PD tickets already exist in the database — skip if so
  try {
    const countResult = await db.select({ cnt: sql<number>`count(*)` }).from(pdTickets);
    const existing = Number(countResult[0]?.cnt ?? 0);
    if (existing > 0) {
      console.log(`[PD-Seed] ${existing} PD tickets already exist, skipping seed`);
      return;
    }
  } catch (err: unknown) {
    console.log(`[PD-Seed] Could not check pd_tickets count (${(err instanceof Error ? err.message : String(err))}), skipping seed`);
    return;
  }

  console.log("[PD-Seed] No PD tickets found, starting import…");

  // ── Step 1: resolve or create all unique users ──
  const userEntries: { name: string; role: string }[] = [];
  for (const r of SOURCE_DATA) {
    if (r.projectDeveloper) userEntries.push({ name: parsePeopleName(r.projectDeveloper), role: r.developerRole });
    if (r.designer) userEntries.push({ name: parsePeopleName(r.designer), role: r.designerRole });
  }
  const uniqueUserMap = new Map<string, string>();
  for (const entry of userEntries) {
    if (entry.name) uniqueUserMap.set(entry.name, entry.role);
  }

  const nameToId: Record<string, number | null> = {};
  for (const [name, role] of uniqueUserMap) {
    let id = await resolveUser(name);
    if (id === null) {
      // Create the user
      const username = name.toLowerCase().replace(/\s+/g, ".");
      const email = `${username}@emergent-energy.co.za`;
      const hashedPassword = await bcrypt.hash("emergent2026", 10);
      try {
        const [created] = await db.insert(users).values({
          username,
          name,
          email,
          password: hashedPassword,
          role,
        }).returning();
        id = created.id;
        console.log(`[PD-Seed] Created user "${name}" (${role}) with id ${id}`);
      } catch (err: unknown) {
        // Username might already exist with different name — try to resolve again
        const [existing] = await db.select().from(users).where(eq(users.username, username));
        if (existing) {
          id = existing.id;
          console.log(`[PD-Seed] Found existing user by username "${username}" with id ${id}`);
        } else {
          console.warn(`[PD-Seed] Could not create user "${name}": ${(err instanceof Error ? err.message : String(err))}`);
        }
      }
    }
    nameToId[name] = id;
  }

  const resolvedCount = Object.values(nameToId).filter(v => v !== null).length;
  console.log(`[PD-Seed] ${resolvedCount}/${uniqueUserMap.size} users resolved/created`);

  // ── Step 2: create or find clients ──
  const uniqueClientNames = new Set<string>();
  for (const r of SOURCE_DATA) {
    if (r.clientName) uniqueClientNames.add(r.clientName);
  }

  const clientNameToId: Record<string, number | null> = {};
  for (const clientName of uniqueClientNames) {
    const existing = await db.select().from(clients).where(ilike(clients.name, clientName)).limit(1);
    if (existing.length > 0) {
      clientNameToId[clientName] = existing[0].id;
      console.log(`[PD-Seed] Found existing client "${clientName}" with id ${existing[0].id}`);
    } else {
      // Generate client ID
      const [countResult] = await db.select({ cnt: count() }).from(clients);
      const nextNum = ((countResult?.cnt || 0) as number) + 1;
      const clientCode = `EE-C${String(nextNum).padStart(4, "0")}`;

      try {
        const [created] = await db.insert(clients).values({
          clientId: clientCode,
          name: clientName,
        }).returning();
        clientNameToId[clientName] = created.id;
        console.log(`[PD-Seed] Created client "${clientName}" (${clientCode}) with id ${created.id}`);
      } catch (err: unknown) {
        console.warn(`[PD-Seed] Could not create client "${clientName}": ${(err instanceof Error ? err.message : String(err))}`);
        clientNameToId[clientName] = null;
      }
    }
  }

  // ── Step 3: create or find projects ──
  const projectNameToId: Record<string, number | null> = {};
  for (const r of SOURCE_DATA) {
    const projName = r.projectSiteName;
    if (projectNameToId[projName] !== undefined) continue;

    const existing = await db.select().from(projectInfo).where(ilike(projectInfo.projectName, projName)).limit(1);
    if (existing.length > 0) {
      projectNameToId[projName] = existing[0].id;
      console.log(`[PD-Seed] Found existing project "${projName}" with id ${existing[0].id}`);
    } else {
      const devName = parsePeopleName(r.projectDeveloper);
      const devUserId = devName ? nameToId[devName] ?? null : null;
      const cId = r.clientName ? clientNameToId[r.clientName] ?? null : null;

      try {
        const [created] = await db.insert(projectInfo).values({
          projectName: projName,
          sizeKwp: r.sizeKwp || null,
          pd: devName || null,
          pdUserId: devUserId,
          clientId: cId,
        }).returning();
        projectNameToId[projName] = created.id;
        console.log(`[PD-Seed] Created project "${projName}" with id ${created.id}`);
      } catch (err: unknown) {
        console.warn(`[PD-Seed] Could not create project "${projName}": ${(err instanceof Error ? err.message : String(err))}`);
        projectNameToId[projName] = null;
      }
    }
  }

  // ── Step 4: Insert seed records (transaction-wrapped) ──
  await db.transaction(async (tx) => {
    let inserted = 0;
    for (const r of SOURCE_DATA) {
      const devName = parsePeopleName(r.projectDeveloper);
      const designerName = parsePeopleName(r.designer);

      await tx.insert(pdTickets).values({
        projectSiteName: r.projectSiteName,
        clientId: r.clientName ? clientNameToId[r.clientName] ?? null : null,
        clientNameSnapshot: r.clientName || r.projectSiteName,
        projectId: projectNameToId[r.projectSiteName] ?? null,
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
  });

  // ── Verify ──
  const verifyResult = await db.select({ cnt: sql<number>`count(*)` }).from(pdTickets);
  const count = Number(verifyResult[0]?.cnt ?? 0);
  console.log(`[PD-Seed] Done — ${count} PD tickets in database`);
}
