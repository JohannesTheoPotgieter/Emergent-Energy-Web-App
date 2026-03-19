import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, sql, inArray, count, isNull, ne } from "drizzle-orm";
import { verifyToken } from "./jwt";
import {
  trItems, trItemProjectLinks, trItemSuggestionDecisions,
  insertTrItemSchema, projectInfo, operationalTasks, entityAssignments,
  type TrItemProjectLink, type TrSuggestionDecision, type ProjectInfo,
} from "@shared/schema";
import { resolveNameToUserId } from "./user-resolver";

type AppUser = { id: number; email: string; name: string; role: string; };

function getUser(req: Request): AppUser {
  return req.user as any as AppUser;
}

function jwtAuth(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user) return next();
  if (req.isAuthenticated?.()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireManager(req: Request, res: Response, next: NextFunction) {
  const role = ((req as any).user as AppUser)?.role || "";
  const allowed = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "admin"];
  if (allowed.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "Manager access required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = ((req as any).user as AppUser)?.role || "";
  const allowed = ["COO_ADMIN", "CEO_ADMIN", "admin"];
  if (allowed.includes(role)) return next();
  res.status(403).json({ error: "forbidden", message: "Admin access required" });
}

const ANCHOR_TOKENS = [
  "Mondi", "Coega", "China Town", "Westway", "Dipula", "Shoprite",
  "Boundary Terraces", "Blackheath", "Paddock", "Randfontein", "Tsakane",
  "Sibasa", "Pretoria North", "Trident", "Pimville", "Swellengrebel",
  "Corporate Park", "Leeu Estate", "Linear Plastics", "Koogan",
];

function parseTrDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const year = parseInt(process.env.TR_DEFAULT_YEAR || "2026", 10);
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const match = dateStr.match(/^(\d{1,2})-(\w{3})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const mon = months[match[2]];
    if (mon !== undefined) return new Date(year, mon, day);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

const TR_SEED_DATA = [
  { trId: "TR026", department: "Finance", actionDescription: "Magic Company Tracker & COS", ragStatus: "Red" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "28-Jan", dueDate: "30-Jan", status: "Completed" as const, dateCompleted: "15-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR024", department: "Matriarch", actionDescription: "Fenner Fire", ragStatus: "Red" as const, owners: ["Johannes"], support: ["Roedolph"], dateRaised: "28-Jan", dueDate: "04-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR003", department: "Construction", actionDescription: "Mayo Macs AC & DC Rework", ragStatus: "Green" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "14-Jan", dueDate: "16-Jan", status: "Completed" as const, dateCompleted: "15-Jan", outcomeComments: "Interrogate the cost of MG", supportingInfo: "" },
  { trId: "TR004", department: "Fedgroup", actionDescription: "Fedgroup Handover Documents", ragStatus: "Amber" as const, owners: ["Roedolph","Peet"], support: ["Johannes"], dateRaised: "13-Jan", dueDate: "05-Feb", status: "Completed" as const, dateCompleted: "08-Feb", outcomeComments: "Dipula and other funded deals. Check Fedgroup dashboard for progress", supportingInfo: "" },
  { trId: "TR023", department: "Matriarch", actionDescription: "Leeu Estate POA", ragStatus: "Red" as const, owners: ["Johannes"], support: ["Roedolph"], dateRaised: "22-Jan", dueDate: "06-Feb", status: "Completed" as const, dateCompleted: "15-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR006", department: "Construction", actionDescription: "Dipula - Updated PC Inspection for ACE", ragStatus: "Green" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "14-Jan", dueDate: "15-Jan", status: "Completed" as const, dateCompleted: "15-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR007", department: "Planning", actionDescription: "Swellengrebel BDP Commission clarification", ragStatus: "Green" as const, owners: ["Roedolph"], support: ["Cole"], dateRaised: "14-Jan", dueDate: "15-Jan", status: "Completed" as const, dateCompleted: "15-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR008", department: "Fedgroup", actionDescription: "Mondi Construction Manager - Appointment letter", ragStatus: "Green" as const, owners: ["Johannes"], support: ["Roedolph"], dateRaised: "13-Jan", dueDate: "16-Jan", status: "Completed" as const, dateCompleted: "26-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR029", department: "Planning", actionDescription: "AdHoc Tracker", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "30-Jan", dueDate: "06-Feb", status: "Completed" as const, dateCompleted: "15-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR010", department: "Planning", actionDescription: "Set up Westway Tracker", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "14-Jan", dueDate: "15-Jan", status: "Completed" as const, dateCompleted: "15-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR011", department: "Finance", actionDescription: "STD Bank Invoices", ragStatus: "Green" as const, owners: ["Roedolph"], support: ["Tasneema"], dateRaised: "15-Jan", dueDate: "24-Jan", status: "Completed" as const, dateCompleted: "26-Jan", outcomeComments: "Invoices are being rejected on the COUPA portal, need to escelate to Avashnee.", supportingInfo: "" },
  { trId: "TR012", department: "Compliance", actionDescription: "PR Eng sign off Rural Retail Portfolio", ragStatus: "Green" as const, owners: ["Peet"], support: [] as string[], dateRaised: "14-Jan", dueDate: "16-Jan", status: "Completed" as const, dateCompleted: "28-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR013", department: "Planning", actionDescription: "Koogan Plastics Timeline", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "15-Jan", dueDate: "23-Jan", status: "Completed" as const, dateCompleted: "19-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR014", department: "Finance", actionDescription: "The Engineering Hub Check and Balance", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "15-Jan", dueDate: "21-Jan", status: "Completed" as const, dateCompleted: "22-Jan", outcomeComments: "Sent an email to them, waiting for feedback", supportingInfo: "" },
  { trId: "TR015", department: "Planning", actionDescription: "Coega Steel Phase 2 - Quote validation", ragStatus: "Green" as const, owners: ["Roedolph"], support: ["Mizelda"], dateRaised: "19-Jan", dueDate: "24-Jan", status: "Completed" as const, dateCompleted: "28-Jan", outcomeComments: "Check Tanaka's email", supportingInfo: "" },
  { trId: "TR016", department: "Finance", actionDescription: "Coega Steel Project Tracker Expense dates up date", ragStatus: "Red" as const, owners: ["Roedolph"], support: ["Mizelda"], dateRaised: "19-Jan", dueDate: "21-Jan", status: "Completed" as const, dateCompleted: "21-Jan", outcomeComments: "Check in with Johannes if anything unclear", supportingInfo: "" },
  { trId: "TR017", department: "Finance", actionDescription: "Project Expenses Overdue", ragStatus: "Amber" as const, owners: ["Mizelda"], support: ["Roedolph","Johannes"], dateRaised: "19-Jan", dueDate: "21-Jan", status: "Completed" as const, dateCompleted: "26-Jan", outcomeComments: "We need to please update the trackers so that the R5m amount is lowered, i will go ahead and assist where i can", supportingInfo: "" },
  { trId: "TR018", department: "Planning", actionDescription: "Switchboard orders", ragStatus: "Red" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "20-Jan", dueDate: "24-Jan", status: "Completed" as const, dateCompleted: "22-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR019", department: "Finance", actionDescription: "Shoprite Mini Bredarsdorp & Superspar Despatch - Schletter Structure", ragStatus: "Red" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "20-Jan", dueDate: "21-Jan", status: "Completed" as const, dateCompleted: "21-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR020", department: "Finance", actionDescription: "Pretoria North schletter credit note", ragStatus: "Green" as const, owners: ["Roedolph"], support: ["Mizelda"], dateRaised: "20-Jan", dueDate: "28-Jan", status: "Completed" as const, dateCompleted: "30-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR035", department: "Planning", actionDescription: "Mondi - Confirmation email of change requests", ragStatus: "Red" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "10-Feb", dueDate: "11-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR022", department: "Engineering", actionDescription: "Update engineering board with allocated panels", ragStatus: "Amber" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "21-Jan", dueDate: "21-Jan", status: "Completed" as const, dateCompleted: "22-Jan", outcomeComments: "", supportingInfo: "" },
  { trId: "TR009", department: "Finance", actionDescription: "Linear Plastics Retention Certificate", ragStatus: "Amber" as const, owners: ["Johannes"], support: ["Roedolph"], dateRaised: "14-Jan", dueDate: "13-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "Followed up again with Johan today", supportingInfo: "" },
  { trId: "TR032", department: "Construction", actionDescription: "Coega Steel - Completion Certificate", ragStatus: "Amber" as const, owners: ["Peet"], support: ["Roedolph"], dateRaised: "02-Feb", dueDate: "13-Feb", status: "Completed" as const, dateCompleted: "13-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR036", department: "Planning", actionDescription: "Update email about whatsapp group change & Photo folder", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "10-Feb", dueDate: "13-Feb", status: "Completed" as const, dateCompleted: "16-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR037", department: "Planning", actionDescription: "Boundary Terraces RMA for Breaker", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "11-Feb", dueDate: "18-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "Breaker must be dropped off at office then taken to SWB", supportingInfo: "" },
  { trId: "TR027", department: "Planning", actionDescription: "Westway viability", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "28-Jan", dueDate: "05-Feb", status: "Completed" as const, dateCompleted: "08-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR028", department: "Construction", actionDescription: "Shoprite Sibasa damage to roof and rectification plan", ragStatus: "Red" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "30-Jan", dueDate: "30-Jan", status: "Completed" as const, dateCompleted: "02-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR039", department: "Planning", actionDescription: "Structural and roof sheeting inspection at Paddock", ragStatus: "Red" as const, owners: ["Roedolph"], support: ["Megan"], dateRaised: "17-Feb", dueDate: "18-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR030", department: "Construction", actionDescription: "Pimville QC Issues", ragStatus: "Red" as const, owners: ["Peet"], support: ["Roedolph"], dateRaised: "30-Jan", dueDate: "06-Feb", status: "Completed" as const, dateCompleted: "10-Feb", outcomeComments: "", supportingInfo: "" },
  { trId: "TR031", department: "Planning", actionDescription: "Justin Project Review", ragStatus: "Red" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "02-Feb", dueDate: "04-Feb", status: "Completed" as const, dateCompleted: "06-Feb", outcomeComments: "7 th Avenue\nBlackheath Park\nBoundary Terraces\nUpper East Side Cable Calcualtion\nChina Town AdHoc", supportingInfo: "" },
  { trId: "TR040", department: "Engineering", actionDescription: "Corporate Park metering site visit", ragStatus: "Amber" as const, owners: ["Roedolph"], support: ["Tanaka"], dateRaised: "17-Feb", dueDate: "19-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR033", department: "Planning", actionDescription: "Tracker Template Update", ragStatus: "Amber" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "09-Feb", dueDate: "23-Feb", status: "Completed" as const, dateCompleted: "15-Feb", outcomeComments: "Picture", supportingInfo: "" },
  { trId: "TR002", department: "Finance", actionDescription: "Trident steel Close Out", ragStatus: "Red" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "24-Nov", dueDate: "20-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "Fixing the COCs.\nMeeting about final milestones - Requested from the client\nSSEG Updates", supportingInfo: "" },
  { trId: "TR005", department: "Finance", actionDescription: "Randfontein & Tsakane VO impact and outcome", ragStatus: "Amber" as const, owners: ["Roedolph"], support: ["Peet"], dateRaised: "14-Jan", dueDate: "20-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR001", department: "Planning", actionDescription: "MSA facelist for contractors.", ragStatus: "Green" as const, owners: ["Roedolph","Johannes"], support: ["Peet"], dateRaised: "12-Jan", dueDate: "28-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "Picture" },
  { trId: "TR021", department: "Compliance", actionDescription: "RMA Tracker with Keith", ragStatus: "Amber" as const, owners: ["Roedolph"], support: ["Johannes"], dateRaised: "20-Jan", dueDate: "28-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR025", department: "Matriarch", actionDescription: "Dipula O&M Handover Docs", ragStatus: "Amber" as const, owners: ["Roedolph"], support: ["Keith"], dateRaised: "28-Jan", dueDate: "28-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR034", department: "Construction", actionDescription: "China Town Phase 1 remediation & Handover Pack", ragStatus: "Amber" as const, owners: ["Roedolph"], support: ["Justin"], dateRaised: "10-Feb", dueDate: "03-Mar", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
  { trId: "TR038", department: "Planning", actionDescription: "Dean's email about the MV work at Coega", ragStatus: "Green" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "12-Feb", dueDate: "30-Mar", status: "Active" as const, dateCompleted: "", outcomeComments: "This is for the cable swop for the MV", supportingInfo: "" },
  { trId: "TR041", department: "Planning", actionDescription: "Mondi - Email about JA Electrical's LOG", ragStatus: "Red" as const, owners: ["Roedolph"], support: [] as string[], dateRaised: "23-Feb", dueDate: "23-Feb", status: "Active" as const, dateCompleted: "", outcomeComments: "", supportingInfo: "" },
];

export async function seedTrRegisterData() {
  try {
    const existing = await db.select({ trId: trItems.trId }).from(trItems);
    if (existing.length >= TR_SEED_DATA.length) {
      console.log(`[Seed] TR Register data already present (${existing.length} items), skipping.`);
      return;
    }
    let created = 0, updated = 0;
    for (const seed of TR_SEED_DATA) {
      const dateRaised = parseTrDate(seed.dateRaised);
      const dueDate = parseTrDate(seed.dueDate);
      const dateCompleted = seed.dateCompleted ? parseTrDate(seed.dateCompleted) : null;
      const [ex] = await db.select().from(trItems).where(eq(trItems.trId, seed.trId));
      if (ex) {
        await db.update(trItems).set({
          department: seed.department, actionDescription: seed.actionDescription,
          ragStatus: seed.ragStatus, owners: seed.owners, support: seed.support,
          dateRaised, dueDate, status: seed.status, dateCompleted,
          outcomeComments: seed.outcomeComments || null, supportingInfo: seed.supportingInfo || null,
          updatedAt: new Date(), updatedBy: "pm-register-seed-v1",
        }).where(eq(trItems.trId, seed.trId));
        updated++;
      } else {
        await db.insert(trItems).values({
          trId: seed.trId, department: seed.department, actionDescription: seed.actionDescription,
          ragStatus: seed.ragStatus, owners: seed.owners, support: seed.support,
          dateRaised, dueDate, status: seed.status, dateCompleted,
          outcomeComments: seed.outcomeComments || null, supportingInfo: seed.supportingInfo || null,
          createdBy: "pm-register-seed-v1", updatedBy: "pm-register-seed-v1",
        });
        created++;
      }
    }
    console.log(`[Seed] TR Register: ${created} created, ${updated} updated.`);
  } catch (err: any) {
    console.error("[Seed] TR Register error:", err.message);
  }
}

export function registerTrRegisterRoutes(app: Express) {
  app.use("/api/tr-register", jwtAuth);

  app.get("/api/tr-register", requireAuth, requirePermission("tr_register", "view"), async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const ragStatus = req.query.ragStatus as string | undefined;
      const department = req.query.department as string | undefined;
      const owner = req.query.owner as string | undefined;
      const overdue = req.query.overdue as string | undefined;
      const linked = req.query.linked as string | undefined;

      const linkCountSubquery = db
        .select({
          trItemId: trItemProjectLinks.trItemId,
          linkedProjectCount: sql<number>`count(*)`.as("linked_project_count"),
        })
        .from(trItemProjectLinks)
        .groupBy(trItemProjectLinks.trItemId)
        .as("link_counts");

      const conditions: any[] = [];
      if (status) conditions.push(eq(trItems.status, status as any));
      if (ragStatus) conditions.push(eq(trItems.ragStatus, ragStatus as any));
      if (department) conditions.push(eq(trItems.department, department));
      if (owner) conditions.push(sql`${owner} = ANY(${trItems.owners})`);
      if (overdue === "true") {
        conditions.push(sql`${trItems.dueDate} < NOW()`);
        conditions.push(ne(trItems.status, "Completed"));
      }

      const query = db
        .select({
          id: trItems.id,
          trId: trItems.trId,
          department: trItems.department,
          actionDescription: trItems.actionDescription,
          ragStatus: trItems.ragStatus,
          owners: trItems.owners,
          support: trItems.support,
          dateRaised: trItems.dateRaised,
          dueDate: trItems.dueDate,
          status: trItems.status,
          dateCompleted: trItems.dateCompleted,
          outcomeComments: trItems.outcomeComments,
          supportingInfo: trItems.supportingInfo,
          createdAt: trItems.createdAt,
          createdBy: trItems.createdBy,
          updatedAt: trItems.updatedAt,
          updatedBy: trItems.updatedBy,
          linkedProjectCount: sql<number>`COALESCE(${linkCountSubquery.linkedProjectCount}, 0)`,
        })
        .from(trItems)
        .leftJoin(linkCountSubquery, eq(trItems.id, linkCountSubquery.trItemId));

      if (linked === "true") {
        conditions.push(sql`${linkCountSubquery.linkedProjectCount} > 0`);
      } else if (linked === "false") {
        conditions.push(sql`${linkCountSubquery.linkedProjectCount} IS NULL`);
      }

      const items = conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(desc(trItems.createdAt))
        : await query.orderBy(desc(trItems.createdAt));

      const { buildUserMap } = await import("./user-resolver");
      const userMap = await buildUserMap();
      const enriched = items.map((item: any) => {
        const ownerUserIds: number[] = [];
        for (const ownerName of (item.owners || [])) {
          const matched = [...userMap.values()].find(
            u => u.name.toLowerCase() === ownerName.toLowerCase()
              || u.username.toLowerCase() === ownerName.toLowerCase()
              || u.name.split(" ")[0].toLowerCase() === ownerName.toLowerCase()
          );
          if (matched) ownerUserIds.push(matched.id);
        }
        return {
          ...item,
          ownerUserIds,
          resolvedOwners: ownerUserIds.map(id => userMap.get(id)).filter(Boolean),
        };
      });
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tr-register/:id", requireAuth, requirePermission("tr_register", "view"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const [item] = await db.select().from(trItems).where(eq(trItems.id, id));
      if (!item) return res.status(404).json({ error: "TR item not found" });

      const links = await db
        .select({
          id: trItemProjectLinks.id,
          trItemId: trItemProjectLinks.trItemId,
          projectId: trItemProjectLinks.projectId,
          autoCreatedPmTaskId: trItemProjectLinks.autoCreatedPmTaskId,
          linkStatus: trItemProjectLinks.linkStatus,
          createdAt: trItemProjectLinks.createdAt,
          createdBy: trItemProjectLinks.createdBy,
          projectName: projectInfo.projectName,
          pm: projectInfo.pm,
        })
        .from(trItemProjectLinks)
        .leftJoin(projectInfo, eq(trItemProjectLinks.projectId, projectInfo.id))
        .where(eq(trItemProjectLinks.trItemId, id));

      res.json({ ...item, linkedProjects: links });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tr-register", requireAuth, requirePermission("tr_register", "create"), async (req: Request, res: Response) => {
    try {
      const userId = getUser(req).id;

      // Resolve ownerUserIds: prefer explicit IDs from client, fall back to name resolution
      let ownerUserIds: number[] = [];
      if (Array.isArray(req.body.ownerUserIds) && req.body.ownerUserIds.length > 0) {
        ownerUserIds = req.body.ownerUserIds.filter((id: unknown) => Number.isFinite(Number(id)) && Number(id) > 0).map(Number);
      } else if (Array.isArray(req.body.owners) && req.body.owners.length > 0) {
        for (const name of req.body.owners) {
          if (typeof name === "string" && name.trim()) {
            const resolved = await resolveNameToUserId(name);
            if (resolved) ownerUserIds.push(resolved);
          }
        }
      }

      const parsed = insertTrItemSchema.parse({
        ...req.body,
        ownerUserIds: ownerUserIds.length > 0 ? ownerUserIds : undefined,
        createdBy: getUser(req).email,
        updatedBy: getUser(req).email,
      });
      const [item] = await db.insert(trItems).values(parsed).returning();

      // Create entity_assignments for each owner
      const ownerNames: string[] = Array.isArray(req.body.owners) ? req.body.owners : [];
      for (let i = 0; i < ownerUserIds.length; i++) {
        const ownerId = ownerUserIds[i];
        const displayLabel = ownerNames[i] || String(ownerId);
        await db.insert(entityAssignments).values({
          entityType: "tr_item",
          entityId: item.id,
          projectId: null,
          assignmentRole: "OWNER",
          assigneeType: "internal_user",
          assigneeId: ownerId,
          displayLabelSnapshot: displayLabel,
          active: true,
          assignedByUserId: userId,
          metadata: null,
          updatedAt: new Date(),
        });
      }

      res.json(item);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/tr-register/:id", requireAuth, requirePermission("tr_register", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const userId = getUser(req).id;
      const [existing] = await db.select().from(trItems).where(eq(trItems.id, id));
      if (!existing) return res.status(404).json({ error: "TR item not found" });

      // Resolve ownerUserIds if owners changed but ownerUserIds not provided
      if (Array.isArray(req.body.owners) && !Array.isArray(req.body.ownerUserIds)) {
        const resolvedIds: number[] = [];
        for (const name of req.body.owners) {
          if (typeof name === "string" && name.trim() && !name.startsWith("counterparty:") && !name.startsWith("contact:")) {
            const resolved = await resolveNameToUserId(name);
            if (resolved) resolvedIds.push(resolved);
          }
        }
        if (resolvedIds.length > 0) {
          req.body.ownerUserIds = resolvedIds;
        }
      }

      const updates = { ...req.body, updatedAt: new Date(), updatedBy: getUser(req).email };
      const [updated] = await db.update(trItems).set(updates).where(eq(trItems.id, id)).returning();

      // Sync entity_assignments when owners/ownerUserIds change
      if (req.body.owners !== undefined || req.body.ownerUserIds !== undefined) {
        const newOwnerIds: number[] = Array.isArray(updated.ownerUserIds) ? updated.ownerUserIds.filter((id): id is number => id != null) : [];
        const ownerNames: string[] = Array.isArray(updated.owners) ? (updated.owners as string[]) : [];

        // Deactivate existing OWNER assignments
        await db.update(entityAssignments).set({
          active: false,
          clearedAt: new Date(),
          clearedByUserId: userId,
          updatedAt: new Date(),
        }).where(and(
          eq(entityAssignments.entityType, "tr_item"),
          eq(entityAssignments.entityId, id),
          eq(entityAssignments.assignmentRole, "OWNER"),
          eq(entityAssignments.active, true),
        ));

        // Create new OWNER assignments
        for (let i = 0; i < newOwnerIds.length; i++) {
          const ownerId = newOwnerIds[i];
          const displayLabel = ownerNames[i] || String(ownerId);
          await db.insert(entityAssignments).values({
            entityType: "tr_item",
            entityId: id,
            projectId: null,
            assignmentRole: "OWNER",
            assigneeType: "internal_user",
            assigneeId: ownerId,
            displayLabelSnapshot: displayLabel,
            active: true,
            assignedByUserId: userId,
            metadata: null,
            updatedAt: new Date(),
          });
        }
      }

      if (req.body.dueDate && String(req.body.dueDate) !== String(existing.dueDate)) {
        const links: TrItemProjectLink[] = await db.select().from(trItemProjectLinks).where(eq(trItemProjectLinks.trItemId, id));
        const taskIds = links
          .filter((l: TrItemProjectLink) => l.autoCreatedPmTaskId != null)
          .map((l: TrItemProjectLink) => l.autoCreatedPmTaskId!);
        if (taskIds.length > 0) {
          const newDueStr = typeof req.body.dueDate === "string"
            ? req.body.dueDate
            : new Date(req.body.dueDate).toISOString().split("T")[0];
          await db.update(operationalTasks)
            .set({ dueDate: newDueStr, updatedAt: new Date() })
            .where(inArray(operationalTasks.id, taskIds));
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/tr-register/:id", requireAuth, requirePermission("tr_register", "delete"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const [existing] = await db.select().from(trItems).where(eq(trItems.id, id));
      if (!existing) return res.status(404).json({ error: "TR item not found" });
      await db.delete(trItems).where(eq(trItems.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tr-register/:id/link", requireAuth, requirePermission("tr_register", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const { projectId } = req.body;

      const [trItem] = await db.select().from(trItems).where(eq(trItems.id, id));
      if (!trItem) return res.status(404).json({ error: "TR item not found" });

      const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
      if (!project) return res.status(404).json({ error: "Project not found" });

      if (!project.pm) {
        return res.status(400).json({ error: "Project has no PM assigned. Cannot create linked task." });
      }

      const [link] = await db.insert(trItemProjectLinks).values({
        trItemId: id,
        projectId,
        createdBy: getUser(req).email,
        updatedBy: getUser(req).email,
      }).returning();

      const dueDateStr = trItem.dueDate
        ? new Date(trItem.dueDate).toISOString().split("T")[0]
        : null;

      const [task] = await db.insert(operationalTasks).values({
        title: `[${trItem.trId}] ${trItem.actionDescription}`,
        projectName: project.projectName,
        priority: "HIGH",
        dueDate: dueDateStr,
        status: "TO DO",
        description: `TR Register item: ${trItem.trId}\n${trItem.actionDescription}\n\nDepartment: ${trItem.department}\nDeep link: /tr-register/${trItem.id}`,
        tags: ["Program Register"],
        createdBy: getUser(req).id,
      }).returning();

      const [updatedLink] = await db.update(trItemProjectLinks)
        .set({ autoCreatedPmTaskId: task.id, linkStatus: "TaskCreated", updatedAt: new Date() })
        .where(eq(trItemProjectLinks.id, link.id))
        .returning();

      res.json({ link: updatedLink, task });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/tr-register/:id/link/:linkId", requireAuth, requirePermission("tr_register", "edit"), async (req: Request, res: Response) => {
    try {
      const linkId = parseInt(req.params.linkId as string);
      const [link] = await db.select().from(trItemProjectLinks).where(eq(trItemProjectLinks.id, linkId));
      if (!link) return res.status(404).json({ error: "Link not found" });

      if (link.autoCreatedPmTaskId) {
        await db.delete(operationalTasks).where(eq(operationalTasks.id, link.autoCreatedPmTaskId));
      }

      await db.delete(trItemProjectLinks).where(eq(trItemProjectLinks.id, linkId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/tr-register/:id/complete", requireAuth, requirePermission("tr_register", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const [trItem] = await db.select().from(trItems).where(eq(trItems.id, id));
      if (!trItem) return res.status(404).json({ error: "TR item not found" });

      if (!trItem.outcomeComments || !trItem.outcomeComments.trim()) {
        return res.status(400).json({ error: "outcomeComments must not be empty before completing" });
      }

      const links: TrItemProjectLink[] = await db.select().from(trItemProjectLinks).where(eq(trItemProjectLinks.trItemId, id));
      const taskIds = links.filter((l: TrItemProjectLink) => l.autoCreatedPmTaskId != null).map((l: TrItemProjectLink) => l.autoCreatedPmTaskId!);

      if (taskIds.length > 0) {
        const incompleteTasks = await db.select({ id: operationalTasks.id })
          .from(operationalTasks)
          .where(and(
            inArray(operationalTasks.id, taskIds),
            ne(operationalTasks.status, "COMPLETE"),
          ));
        if (incompleteTasks.length > 0) {
          return res.status(400).json({
            error: `Cannot complete: ${incompleteTasks.length} linked PM task(s) are not yet complete`,
          });
        }
      }

      const [updated] = await db.update(trItems).set({
        status: "Completed",
        dateCompleted: new Date(),
        updatedAt: new Date(),
        updatedBy: getUser(req).email,
      }).where(eq(trItems.id, id)).returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tr-register/:id/suggest-links", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const [trItem] = await db.select().from(trItems).where(eq(trItems.id, id));
      if (!trItem) return res.status(404).json({ error: "TR item not found" });

      const searchText = [
        trItem.actionDescription,
        trItem.department,
        trItem.outcomeComments,
        trItem.supportingInfo,
        trItem.trId,
      ].filter(Boolean).join(" ").toLowerCase();

      const searchTokens = searchText.split(/\s+/).filter((t: string) => t.length > 2);
      const outcomeLines = (trItem.outcomeComments || "").split("\n").filter((l: string) => l.trim());

      const allProjects = await db.select().from(projectInfo);

      const existingLinks = await db.select({ projectId: trItemProjectLinks.projectId })
        .from(trItemProjectLinks)
        .where(eq(trItemProjectLinks.trItemId, id));
      const linkedIds = new Set(existingLinks.map((l: { projectId: number }) => l.projectId));

      const decisions: TrSuggestionDecision[] = await db.select()
        .from(trItemSuggestionDecisions)
        .where(eq(trItemSuggestionDecisions.trItemId, id));
      const rejectedIds = new Set(decisions.filter((d: TrSuggestionDecision) => d.decision === "Rejected").map((d: TrSuggestionDecision) => d.projectId));
      const suppressedIds = new Set(decisions.filter((d: TrSuggestionDecision) => d.decision === "Suppressed").map((d: TrSuggestionDecision) => d.projectId));

      type ScoredProject = { projectId: number; projectName: string; score: number; rationale: string[] };
      const scored: ScoredProject[] = allProjects.map((project: ProjectInfo) => {
        let score = 0;
        const rationale: string[] = [];
        const pName = project.projectName.toLowerCase();
        const pTokens = pName.split(/[\s_-]+/).filter((t: string) => t.length > 2);

        if (searchText.includes(pName)) {
          score += 50;
          rationale.push("Exact project name match in TR text (+50)");
        }

        let tokenMatches = 0;
        for (const pt of pTokens) {
          if (searchTokens.includes(pt)) {
            tokenMatches++;
            if (tokenMatches <= 3) score += 20;
          }
        }
        if (tokenMatches > 0) {
          rationale.push(`Token overlap: ${Math.min(tokenMatches, 3)} tokens (+${Math.min(tokenMatches, 3) * 20})`);
        }

        for (const anchor of ANCHOR_TOKENS) {
          const anchorLower = anchor.toLowerCase();
          if (pName.includes(anchorLower) && searchText.includes(anchorLower)) {
            score += 15;
            rationale.push(`Anchor token match: ${anchor} (+15)`);
          }
        }

        for (const line of outcomeLines) {
          const lineLower = line.trim().toLowerCase();
          if (lineLower.length > 5 && pName.includes(lineLower.substring(0, Math.min(lineLower.length, 15)))) {
            score += 10;
            rationale.push("Fuzzy line match in outcomeComments (+10)");
            break;
          }
        }

        if (linkedIds.has(project.id)) {
          score -= 100;
          rationale.push("Already linked (-100)");
        }
        if (rejectedIds.has(project.id)) {
          score -= 50;
          rationale.push("Previously rejected (-50)");
        }
        if (suppressedIds.has(project.id)) {
          score -= 999;
          rationale.push("Suppressed (-999)");
        }

        return { projectId: project.id, projectName: project.projectName, score, rationale };
      });

      scored.sort((a: ScoredProject, b: ScoredProject) => b.score - a.score);
      res.json(scored.slice(0, 8));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tr-register/:id/suggestion-decision", requireAuth, requirePermission("tr_register", "edit"), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const { projectId, decision } = req.body;

      if (!["Accepted", "Rejected", "Suppressed"].includes(decision)) {
        return res.status(400).json({ error: "Invalid decision. Must be Accepted, Rejected, or Suppressed" });
      }

      const [existing] = await db.select().from(trItemSuggestionDecisions)
        .where(and(
          eq(trItemSuggestionDecisions.trItemId, id),
          eq(trItemSuggestionDecisions.projectId, projectId),
        ));

      if (existing) {
        await db.update(trItemSuggestionDecisions)
          .set({ decision, decidedAt: new Date(), decidedBy: getUser(req).email })
          .where(eq(trItemSuggestionDecisions.id, existing.id));
      } else {
        await db.insert(trItemSuggestionDecisions).values({
          trItemId: id,
          projectId,
          decision,
          decidedAt: new Date(),
          decidedBy: getUser(req).email,
        });
      }

      let linkResult = null;
      if (decision === "Accepted") {
        const [trItem] = await db.select().from(trItems).where(eq(trItems.id, id));
        const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));

        if (trItem && project && project.pm) {
          const [link] = await db.insert(trItemProjectLinks).values({
            trItemId: id,
            projectId,
            createdBy: getUser(req).email,
            updatedBy: getUser(req).email,
          }).returning();

          const dueDateStr = trItem.dueDate
            ? new Date(trItem.dueDate).toISOString().split("T")[0]
            : null;

          const [task] = await db.insert(operationalTasks).values({
            title: `[${trItem.trId}] ${trItem.actionDescription}`,
            projectName: project.projectName,
            priority: "HIGH",
            dueDate: dueDateStr,
            status: "TO DO",
            description: `TR Register item: ${trItem.trId}\n${trItem.actionDescription}\n\nDepartment: ${trItem.department}\nDeep link: /tr-register/${trItem.id}`,
            tags: ["Program Register"],
            createdBy: getUser(req).id,
          }).returning();

          await db.update(trItemProjectLinks)
            .set({ autoCreatedPmTaskId: task.id, linkStatus: "TaskCreated", updatedAt: new Date() })
            .where(eq(trItemProjectLinks.id, link.id));

          linkResult = { link, task };
        }
      }

      res.json({ success: true, decision, linkResult });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

}
