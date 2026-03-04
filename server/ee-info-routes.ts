import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eeInfoNodes, eeInfoEdges, eeInfoAssets, eeInfoVersions, eeInfoSettings, eeInfoNodeDetails, eeInfoNodeEditors, eeInfoNodeMetrics, projectInfo } from "@shared/schema";
import { eq, sql, ilike, and, or, inArray } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import multer from "multer";
import { verifyToken } from "./jwt";

const SEED_ZIP_PATH = path.join(process.cwd(), "seed", "ee-info", "Emergent Energy.zip");
const ASSETS_DIR = path.join(process.cwd(), "uploads", "ee-info-assets");

function generateId(): string {
  return crypto.randomUUID();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() && req.user) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
      return next();
    }
  }
  return res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireCOO(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.() && !req.user) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload) {
        (req as any).user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role };
      }
    }
    if (!req.user) return res.status(401).json({ error: "auth_required" });
  }
  const role = (req.user as any).role || (req.user as any).companyRole;
  if (role === "COO_ADMIN" || role === "admin" || role === "CEO_ADMIN") {
    return next();
  }
  return res.status(403).json({ error: "forbidden", message: "COO access required" });
}

function categorizeNode(title: string, content: string | null): string {
  const t = title.toLowerCase();
  const roleKeywords = ["officer", "manager", "director", "head of", "engineer", "developer"];
  if (roleKeywords.some(k => t.includes(k))) return "role";

  const governanceKeywords = ["cos realisation", "revenue milestone", "vo approval", "cashflow forecast", "financial governance", "risk register", "safety governance", "qa governance", "quality assurance governance"];
  if (governanceKeywords.some(k => t.includes(k))) return "governance";

  const processPatterns = [/\(p[dma]+\d*\)/i, /\(epm?\d*\)/i, /\(cpm\d*\)/i, /\(pdpm\d*\)/i, /process/i, /planning/i, /construction/i, /hand over/i, /commissioning/i, /close out/i, /engagement/i, /assessment/i, /procurement/i, /invoic/i, /payment/i, /inventory/i, /compliance/i, /hse/i, /red team/i, /research/i, /relationship/i, /deal/i, /tender/i, /site visit/i, /meter/i, /data tool/i, /engineering design/i, /engineering pack/i, /cost proposal/i, /final offer/i, /sseg/i, /lifecycle phase/i, /execution phase/i, /handover/i, /o&m transfer/i];
  if (processPatterns.some(p => p.test(t))) return "process";

  const toolKeywords = ["click up", "sharepoint", "ms teams", "matriarch", "web application", "emergent energy web"];
  if (toolKeywords.some(k => t.includes(k))) return "tool";

  const templateKeywords = ["template", "charter", "report", "agreement", "purchase order"];
  if (templateKeywords.some(k => t.includes(k))) return "template";

  if (t === "emergent energy") return "other";
  return "unknown";
}

function extractFlowInfo(content: string): { nextSlugs: string[]; prevSlugs: string[] } {
  const nextSlugs: string[] = [];
  const prevSlugs: string[] = [];

  const nextMatch = content.match(/\*Next\s+Step\*\s*\n([\s\S]*?)(?=\n\*|\n\n\*|\n[^[\n]|$)/i);
  if (nextMatch) {
    const links = nextMatch[1].matchAll(/\[\[([^\]]+)\]\]/g);
    for (const m of links) nextSlugs.push(slugify(m[1]));
  }

  const prevMatch = content.match(/\*Previous\s+Step\*\s*\n([\s\S]*?)(?=\n\*|\n\n\*|\n[^[\n]|$)/i);
  if (prevMatch) {
    const links = prevMatch[1].matchAll(/\[\[([^\]]+)\]\]/g);
    for (const m of links) prevSlugs.push(slugify(m[1]));
  }

  return { nextSlugs, prevSlugs };
}

function extractWikiLinks(content: string): { links: string[]; embeds: string[] } {
  const links: string[] = [];
  const embeds: string[] = [];

  const embedMatches = content.matchAll(/!\[\[([^\]]+)\]\]/g);
  for (const m of embedMatches) embeds.push(m[1]);

  const linkMatches = content.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g);
  for (const m of linkMatches) {
    if (!/\.(png|jpg|jpeg|webp|gif|pdf|svg)$/i.test(m[1])) {
      links.push(m[1]);
    }
  }

  return { links, embeds };
}

export async function importObsidianZip(zipPath: string, importedBy: string = "system"): Promise<{ nodes: number; edges: number; assets: number }> {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  const mdEntries = entries.filter((e: any) => e.entryName.endsWith(".md") && !e.isDirectory);
  const assetEntries = entries.filter((e: any) => /\.(png|jpg|jpeg|webp|gif|pdf|svg)$/i.test(e.entryName) && !e.isDirectory);

  const nodeMap = new Map<string, { id: string; slug: string; title: string; content: string | null; category: string; flowEnabled: boolean; nextSlugs: string[]; prevSlugs: string[] }>();
  const edgesToCreate: { fromSlug: string; toSlug: string; type: string }[] = [];
  const assetRefs: { filename: string; referencedBy: string[] }[] = [];

  for (const entry of mdEntries) {
    try {
      const filename = path.basename(entry.entryName, ".md");
      const slug = slugify(filename);
      const title = filename;
      const content = entry.getData().toString("utf8");
      const category = categorizeNode(title, content);

      const flowInfo = extractFlowInfo(content);
      const flowEnabled = flowInfo.nextSlugs.length > 0 || flowInfo.prevSlugs.length > 0;

      nodeMap.set(slug, {
        id: generateId(),
        slug,
        title,
        content,
        category,
        flowEnabled,
        nextSlugs: flowInfo.nextSlugs,
        prevSlugs: flowInfo.prevSlugs,
      });

      const { links, embeds } = extractWikiLinks(content);
      for (const link of links) {
        edgesToCreate.push({ fromSlug: slug, toSlug: slugify(link), type: "link" });
      }
      for (const embed of embeds) {
        if (/\.(png|jpg|jpeg|webp|gif|pdf|svg)$/i.test(embed)) {
          const existing = assetRefs.find(a => a.filename === embed);
          if (existing) existing.referencedBy.push(slug);
          else assetRefs.push({ filename: embed, referencedBy: [slug] });
        } else {
          edgesToCreate.push({ fromSlug: slug, toSlug: slugify(embed), type: "embed" });
        }
      }
    } catch (err) {
      console.warn(`[EE-Info] Warning: Could not process ${entry.entryName}:`, err);
    }
  }

  for (const edge of edgesToCreate) {
    if (!nodeMap.has(edge.toSlug)) {
      const stubTitle = edge.toSlug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      nodeMap.set(edge.toSlug, {
        id: generateId(),
        slug: edge.toSlug,
        title: stubTitle,
        content: null,
        category: "unknown",
        flowEnabled: false,
        nextSlugs: [],
        prevSlugs: [],
      });
    }
  }

  await db.delete(eeInfoEdges);
  await db.delete(eeInfoAssets);
  await db.delete(eeInfoVersions);
  await db.delete(eeInfoNodes);

  const nodeValues = Array.from(nodeMap.values());
  for (let i = 0; i < nodeValues.length; i += 50) {
    const batch = nodeValues.slice(i, i + 50);
    await db.insert(eeInfoNodes).values(batch.map(n => ({
      id: n.id,
      slug: n.slug,
      title: n.title,
      contentMarkdown: n.content,
      status: n.content ? "published" : "stub",
      category: n.category,
      tags: [],
      flowEnabled: n.flowEnabled,
      nextSlugs: n.nextSlugs,
      prevSlugs: n.prevSlugs,
      createdBy: importedBy,
      updatedBy: importedBy,
    })));
  }

  const edgeSet = new Set<string>();
  let edgeCount = 0;
  for (const edge of edgesToCreate) {
    const fromNode = nodeMap.get(edge.fromSlug);
    const toNode = nodeMap.get(edge.toSlug);
    if (!fromNode || !toNode) continue;
    const key = `${fromNode.id}:${toNode.id}:${edge.type}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);

    try {
      await db.insert(eeInfoEdges).values({
        id: generateId(),
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        edgeType: edge.type,
      });
      edgeCount++;
    } catch (err) {
      console.warn(`[EE-Info] Warning: Could not create edge ${edge.fromSlug} -> ${edge.toSlug}:`, err);
    }
  }

  let assetCount = 0;
  for (const assetEntry of assetEntries) {
    try {
      const filename = path.basename(assetEntry.entryName);
      const data = assetEntry.getData();
      const assetPath = path.join(ASSETS_DIR, filename);
      fs.writeFileSync(assetPath, data);

      const ref = assetRefs.find(a => a.filename === filename);
      const nodeId = ref && ref.referencedBy.length > 0 ? nodeMap.get(ref.referencedBy[0])?.id || null : null;

      const ext = path.extname(filename).toLowerCase();
      const mimeMap: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf", ".svg": "image/svg+xml" };

      await db.insert(eeInfoAssets).values({
        id: generateId(),
        nodeId,
        filename,
        mimeType: mimeMap[ext] || "application/octet-stream",
        storagePath: assetPath,
        uploadedBy: importedBy,
      });
      assetCount++;
    } catch (err) {
      console.warn(`[EE-Info] Warning: Could not store asset ${assetEntry.entryName}:`, err);
    }
  }

  console.log(`[EE-Info] Import complete: ${nodeValues.length} nodes, ${edgeCount} edges, ${assetCount} assets`);
  return { nodes: nodeValues.length, edges: edgeCount, assets: assetCount };
}

export async function bootImportCheck(): Promise<void> {
  try {
    if (!fs.existsSync(SEED_ZIP_PATH)) {
      console.log("[EE-Info] No seed zip found at", SEED_ZIP_PATH, "— skipping boot import");
      return;
    }

    try {
      await db.execute(sql`SELECT 1 FROM ee_info_nodes LIMIT 1`);
    } catch {
      console.log("[EE-Info] Tables not yet created, skipping boot import (will retry after schema push)");
      return;
    }

    const zipData = fs.readFileSync(SEED_ZIP_PATH);
    const currentHash = crypto.createHash("sha256").update(zipData).digest("hex");

    const settings = await db.select().from(eeInfoSettings).limit(1);
    const setting = settings[0];

    const nodeCount = await db.select({ count: sql<number>`count(*)` }).from(eeInfoNodes);
    const isEmpty = !nodeCount[0] || Number(nodeCount[0].count) === 0;

    if (!isEmpty && setting?.seedImportHash === currentHash) {
      console.log("[EE-Info] Seed already imported (hash matches), skipping");
      return;
    }

    console.log("[EE-Info] Starting boot import...", isEmpty ? "(empty DB)" : "(hash changed)");
    const result = await importObsidianZip(SEED_ZIP_PATH, "system");

    if (setting) {
      await db.update(eeInfoSettings).set({
        seedImportCompleted: true,
        seedImportHash: currentHash,
        seedImportedAt: new Date(),
        seedImportedBy: "system",
      }).where(eq(eeInfoSettings.id, setting.id));
    } else {
      await db.insert(eeInfoSettings).values({
        seedImportCompleted: true,
        seedImportHash: currentHash,
        seedImportedAt: new Date(),
        seedImportedBy: "system",
      });
    }

    console.log(`[EE-Info] Boot import finished: ${result.nodes} nodes, ${result.edges} edges, ${result.assets} assets`);
  } catch (err) {
    console.error("[EE-Info] Boot import error (non-fatal):", err);
  }
}

const assetUpload = multer({ dest: ASSETS_DIR });

export function registerEeInfoRoutes(app: Express) {
  app.get("/api/ee-info/nodes", requireAuth, async (_req, res) => {
    try {
      const search = (_req.query.search as string) || "";
      const category = _req.query.category as string;
      const flowEnabled = _req.query.flow_enabled as string;

      let query = db.select().from(eeInfoNodes);
      const conditions = [];

      if (search) {
        conditions.push(or(
          ilike(eeInfoNodes.title, `%${search}%`),
          ilike(eeInfoNodes.slug, `%${search}%`)
        ));
      }
      if (category) {
        conditions.push(eq(eeInfoNodes.category, category));
      }
      if (flowEnabled === "true") {
        conditions.push(eq(eeInfoNodes.flowEnabled, true));
      }

      const nodes = conditions.length > 0
        ? await db.select().from(eeInfoNodes).where(and(...conditions))
        : await db.select().from(eeInfoNodes);

      res.json(nodes);
    } catch (err) {
      console.error("[EE-Info] Error fetching nodes:", err);
      res.status(500).json({ error: "Failed to fetch nodes" });
    }
  });

  app.get("/api/ee-info/nodes/:slug", requireAuth, async (req, res) => {
    try {
      const { slug } = req.params;
      const nodes = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, slug));
      if (nodes.length === 0) return res.status(404).json({ error: "Node not found" });

      const node = nodes[0];
      const assets = await db.select().from(eeInfoAssets).where(eq(eeInfoAssets.nodeId, node.id));

      const outbound = await db.select().from(eeInfoEdges).where(eq(eeInfoEdges.fromNodeId, node.id));
      const inbound = await db.select().from(eeInfoEdges).where(eq(eeInfoEdges.toNodeId, node.id));

      const linkedNodeIds = [...new Set([...outbound.map(e => e.toNodeId), ...inbound.map(e => e.fromNodeId)])];
      let linkedNodes: any[] = [];
      if (linkedNodeIds.length > 0) {
        linkedNodes = await db.select({ id: eeInfoNodes.id, slug: eeInfoNodes.slug, title: eeInfoNodes.title, category: eeInfoNodes.category, status: eeInfoNodes.status }).from(eeInfoNodes).where(inArray(eeInfoNodes.id, linkedNodeIds));
      }

      res.json({
        ...node,
        assets,
        outboundEdges: outbound.map(e => ({
          ...e,
          targetNode: linkedNodes.find(n => n.id === e.toNodeId),
        })),
        inboundEdges: inbound.map(e => ({
          ...e,
          sourceNode: linkedNodes.find(n => n.id === e.fromNodeId),
        })),
      });
    } catch (err) {
      console.error("[EE-Info] Error fetching node:", err);
      res.status(500).json({ error: "Failed to fetch node" });
    }
  });

  app.get("/api/ee-info/graph", requireAuth, async (_req, res) => {
    try {
      const category = _req.query.category as string;
      let nodes;
      if (category) {
        nodes = await db.select({ id: eeInfoNodes.id, slug: eeInfoNodes.slug, title: eeInfoNodes.title, category: eeInfoNodes.category, status: eeInfoNodes.status, flowEnabled: eeInfoNodes.flowEnabled }).from(eeInfoNodes).where(eq(eeInfoNodes.category, category));
      } else {
        nodes = await db.select({ id: eeInfoNodes.id, slug: eeInfoNodes.slug, title: eeInfoNodes.title, category: eeInfoNodes.category, status: eeInfoNodes.status, flowEnabled: eeInfoNodes.flowEnabled }).from(eeInfoNodes);
      }
      const edges = await db.select().from(eeInfoEdges);

      const nodeIds = new Set(nodes.map(n => n.id));
      const filteredEdges = category
        ? edges.filter(e => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId))
        : edges;

      res.json({ nodes, edges: filteredEdges });
    } catch (err) {
      console.error("[EE-Info] Error fetching graph:", err);
      res.status(500).json({ error: "Failed to fetch graph" });
    }
  });

  app.get("/api/ee-info/flow", requireAuth, async (_req, res) => {
    try {
      const nodes = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.flowEnabled, true));
      res.json(nodes);
    } catch (err) {
      console.error("[EE-Info] Error fetching flow:", err);
      res.status(500).json({ error: "Failed to fetch flow" });
    }
  });

  app.get("/api/ee-info/settings", requireAuth, async (_req, res) => {
    try {
      const settings = await db.select().from(eeInfoSettings).limit(1);
      res.json(settings[0] || { seedImportCompleted: false });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.get("/api/ee-info/assets/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      const assetPath = path.join(ASSETS_DIR, filename);
      if (!fs.existsSync(assetPath)) return res.status(404).json({ error: "Asset not found" });
      res.sendFile(assetPath);
    } catch (err) {
      res.status(500).json({ error: "Failed to serve asset" });
    }
  });

  app.post("/api/ee-info/nodes", requireAuth, requireCOO, async (req, res) => {
    try {
      const { title, contentMarkdown, category, tags, flowEnabled, flowLane, flowStepCode, nextSlugs, prevSlugs, gateConditions, blockingConditions, responsibleRole, escalationRole } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required" });

      const slug = slugify(title);
      const id = generateId();
      const userId = String((req.user as any)?.id || "unknown");

      await db.insert(eeInfoNodes).values({
        id, slug, title,
        contentMarkdown: contentMarkdown || null,
        status: contentMarkdown ? "published" : "draft",
        category: category || "unknown",
        tags: tags || [],
        flowEnabled: flowEnabled || false,
        flowLane: flowLane || null,
        flowStepCode: flowStepCode || null,
        nextSlugs: nextSlugs || [],
        prevSlugs: prevSlugs || [],
        gateConditions: gateConditions || [],
        blockingConditions: blockingConditions || [],
        responsibleRole: responsibleRole || null,
        escalationRole: escalationRole || null,
        createdBy: userId,
        updatedBy: userId,
      });

      const [node] = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, id));
      res.status(201).json(node);
    } catch (err) {
      console.error("[EE-Info] Error creating node:", err);
      res.status(500).json({ error: "Failed to create node" });
    }
  });

  app.put("/api/ee-info/nodes/:id", requireAuth, requireCOO, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, id));
      if (existing.length === 0) return res.status(404).json({ error: "Node not found" });

      const userId = String((req.user as any)?.id || "unknown");
      const { title, contentMarkdown, category, tags, status, flowEnabled, flowLane, flowStepCode, nextSlugs, prevSlugs, gateConditions, blockingConditions, responsibleRole, escalationRole } = req.body;

      if (existing[0].contentMarkdown !== contentMarkdown) {
        await db.insert(eeInfoVersions).values({
          id: generateId(),
          nodeId: id,
          contentMarkdown: existing[0].contentMarkdown,
          changedBy: userId,
          changeNote: "Before edit",
        });
      }

      const updates: any = { updatedAt: new Date(), updatedBy: userId };
      if (title !== undefined) { updates.title = title; updates.slug = slugify(title); }
      if (contentMarkdown !== undefined) updates.contentMarkdown = contentMarkdown;
      if (category !== undefined) updates.category = category;
      if (tags !== undefined) updates.tags = tags;
      if (status !== undefined) updates.status = status;
      if (flowEnabled !== undefined) updates.flowEnabled = flowEnabled;
      if (flowLane !== undefined) updates.flowLane = flowLane;
      if (flowStepCode !== undefined) updates.flowStepCode = flowStepCode;
      if (nextSlugs !== undefined) updates.nextSlugs = nextSlugs;
      if (prevSlugs !== undefined) updates.prevSlugs = prevSlugs;
      if (gateConditions !== undefined) updates.gateConditions = gateConditions;
      if (blockingConditions !== undefined) updates.blockingConditions = blockingConditions;
      if (responsibleRole !== undefined) updates.responsibleRole = responsibleRole;
      if (escalationRole !== undefined) updates.escalationRole = escalationRole;

      await db.update(eeInfoNodes).set(updates).where(eq(eeInfoNodes.id, id));
      const [updated] = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, id));
      res.json(updated);
    } catch (err) {
      console.error("[EE-Info] Error updating node:", err);
      res.status(500).json({ error: "Failed to update node" });
    }
  });

  app.delete("/api/ee-info/nodes/:id", requireAuth, requireCOO, async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(eeInfoEdges).where(or(eq(eeInfoEdges.fromNodeId, id), eq(eeInfoEdges.toNodeId, id)));
      await db.delete(eeInfoAssets).where(eq(eeInfoAssets.nodeId, id));
      await db.delete(eeInfoVersions).where(eq(eeInfoVersions.nodeId, id));
      await db.delete(eeInfoNodes).where(eq(eeInfoNodes.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error("[EE-Info] Error deleting node:", err);
      res.status(500).json({ error: "Failed to delete node" });
    }
  });

  app.post("/api/ee-info/nodes/:id/assets", requireAuth, requireCOO, assetUpload.single("file"), async (req, res) => {
    try {
      const { id } = req.params;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const userId = String((req.user as any)?.id || "unknown");
      const finalPath = path.join(ASSETS_DIR, file.originalname);
      fs.renameSync(file.path, finalPath);

      const assetId = generateId();
      await db.insert(eeInfoAssets).values({
        id: assetId,
        nodeId: id,
        filename: file.originalname,
        mimeType: file.mimetype,
        storagePath: finalPath,
        uploadedBy: userId,
      });

      const [asset] = await db.select().from(eeInfoAssets).where(eq(eeInfoAssets.id, assetId));
      res.status(201).json(asset);
    } catch (err) {
      console.error("[EE-Info] Error uploading asset:", err);
      res.status(500).json({ error: "Failed to upload asset" });
    }
  });

  app.post("/api/ee-info/import/obsidian-zip", requireAuth, requireCOO, async (_req, res) => {
    try {
      if (!fs.existsSync(SEED_ZIP_PATH)) {
        return res.status(404).json({ error: "Seed zip not found" });
      }
      const result = await importObsidianZip(SEED_ZIP_PATH, String((_req.user as any)?.id || "system"));

      const zipData = fs.readFileSync(SEED_ZIP_PATH);
      const currentHash = crypto.createHash("sha256").update(zipData).digest("hex");

      const settings = await db.select().from(eeInfoSettings).limit(1);
      if (settings[0]) {
        await db.update(eeInfoSettings).set({
          seedImportCompleted: true,
          seedImportHash: currentHash,
          seedImportedAt: new Date(),
          seedImportedBy: String((_req.user as any)?.id || "system"),
        }).where(eq(eeInfoSettings.id, settings[0].id));
      } else {
        await db.insert(eeInfoSettings).values({
          seedImportCompleted: true,
          seedImportHash: currentHash,
          seedImportedAt: new Date(),
          seedImportedBy: String((_req.user as any)?.id || "system"),
        });
      }

      res.json({ success: true, ...result });
    } catch (err) {
      console.error("[EE-Info] Error re-importing:", err);
      res.status(500).json({ error: "Failed to re-import" });
    }
  });

  app.post("/api/ee-info/post-seed-align", requireAuth, requireCOO, async (req, res) => {
    try {
      const userId = String((req.user as any)?.id || "system");
      const created: string[] = [];
      const updated: string[] = [];
      const skipped: string[] = [];

      async function upsertNode(def: {
        slug: string; title: string; category: string; contentMarkdown: string;
        tags?: string[]; flowEnabled?: boolean; flowLane?: string; flowStepCode?: string;
        gateConditions?: string[]; blockingConditions?: string[];
        responsibleRole?: string; escalationRole?: string;
        nextSlugs?: string[]; prevSlugs?: string[];
      }) {
        const existing = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, def.slug));
        if (existing.length > 0) {
          await db.update(eeInfoNodes).set({
            contentMarkdown: def.contentMarkdown,
            category: def.category,
            tags: def.tags || existing[0].tags || [],
            flowEnabled: def.flowEnabled ?? existing[0].flowEnabled,
            flowLane: def.flowLane ?? existing[0].flowLane,
            flowStepCode: def.flowStepCode ?? existing[0].flowStepCode,
            gateConditions: def.gateConditions || [],
            blockingConditions: def.blockingConditions || [],
            responsibleRole: def.responsibleRole || null,
            escalationRole: def.escalationRole || null,
            nextSlugs: def.nextSlugs || existing[0].nextSlugs || [],
            prevSlugs: def.prevSlugs || existing[0].prevSlugs || [],
            status: "published",
            updatedAt: new Date(),
            updatedBy: userId,
          }).where(eq(eeInfoNodes.id, existing[0].id));
          updated.push(def.title);
        } else {
          await db.insert(eeInfoNodes).values({
            id: generateId(),
            slug: def.slug,
            title: def.title,
            contentMarkdown: def.contentMarkdown,
            status: "published",
            category: def.category,
            tags: def.tags || [],
            flowEnabled: def.flowEnabled || false,
            flowLane: def.flowLane || null,
            flowStepCode: def.flowStepCode || null,
            nextSlugs: def.nextSlugs || [],
            prevSlugs: def.prevSlugs || [],
            gateConditions: def.gateConditions || [],
            blockingConditions: def.blockingConditions || [],
            responsibleRole: def.responsibleRole || null,
            escalationRole: def.escalationRole || null,
            createdBy: userId,
            updatedBy: userId,
          });
          created.push(def.title);
        }
      }

      async function ensureEdge(fromSlug: string, toSlug: string, type: string = "link") {
        const fromNodes = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, fromSlug));
        const toNodes = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, toSlug));
        if (!fromNodes[0] || !toNodes[0]) return;
        const existing = await db.select().from(eeInfoEdges).where(
          and(eq(eeInfoEdges.fromNodeId, fromNodes[0].id), eq(eeInfoEdges.toNodeId, toNodes[0].id), eq(eeInfoEdges.edgeType, type))
        );
        if (existing.length === 0) {
          await db.insert(eeInfoEdges).values({
            id: generateId(), fromNodeId: fromNodes[0].id, toNodeId: toNodes[0].id, edgeType: type,
          });
        }
      }

      await upsertNode({
        slug: "construction-manager", title: "Construction Manager", category: "role",
        contentMarkdown: "# Construction Manager\n\nThe Construction Manager oversees all on-site construction activities for Emergent Energy projects.\n\n## Responsibilities\n- Site management and daily construction oversight\n- Coordination of subcontractors and trades on site\n- Health, Safety and Environmental (HSE) compliance on site\n- Construction schedule management and progress reporting\n- Quality assurance of installed works\n- Interface management between design engineering and site execution\n- Punch list and defect tracking\n- Handover preparation and documentation\n\n## Reports To\n[[Project Manager]]\n\n## Interfaces With\n- [[Design Engineer]] — technical queries and RFIs\n- [[Project Engineer (Quality)]] — quality inspections and ITP compliance\n- [[HSE Officer]] — safety compliance and incident management\n- [[Procurement]] — material delivery coordination",
        tags: ["role", "construction", "site"],
        responsibleRole: "Construction Manager",
      });

      await upsertNode({
        slug: "emergent-energy-web-application", title: "Emergent Energy Web Application", category: "tool",
        contentMarkdown: "# Emergent Energy Web Application\n\nThe core project management and financial tracking platform for Emergent Energy.\n\n## Capabilities\n- **Smart Import** — Excel tracker ingestion with font-color-aware COS and cashflow status detection\n- **Execution Board** — Real-time project status dashboard with RAG indicators\n- **COS Tracker** — Cost of Sales tracking with Realised/Deferred/Flagged/Planned status classification\n- **Cashflow Management** — Payment tracking, forecasting, and bank reconciliation\n- **Revenue Tracker** — Milestone-based revenue recognition\n- **Engineering Dashboard** — Task management and phase tracking\n- **Quality Management** — QM dashboard and compliance tracking\n- **TR Register** — Cross-project action item tracking\n- **Weekly Reviews** — Structured weekly review wizard\n- **EE Info** — This knowledge base (Obsidian-sourced graph/detail/flow viewer)\n- **Subcontractor Dashboard** — Procurement and subcontractor management\n- **Admin** — Roles, permissions, audit trails, and system configuration\n\n## Technology Stack\n- React + TypeScript frontend with shadcn/ui\n- Express.js + PostgreSQL backend with Drizzle ORM\n- Hosted on Replit\n\n## Access\nRole-based access control with Permission Gate System. COO/CEO/Admin users have full access.",
        tags: ["tool", "platform", "core"],
      });

      await upsertNode({
        slug: "cos-realisation-logic", title: "COS Realisation Logic", category: "governance",
        contentMarkdown: "# COS Realisation Logic\n\nDefines how Cost of Sales status is determined for each expenditure line item.\n\n## Status Definitions\n\n### COS Realised\nInvoice number present + Invoice date present\n- Logic: `hasInvoice && hasInvoiceDate`\n- An item is realised once an invoice has been captured with a date\n\n### Committed\nPO number or Invoice number present, but invoice date is missing\n- Cost is committed but not yet realised\n\n### Planned\nDefault state for all other lines\n- No PO, no invoice, or insufficient data",
        tags: ["governance", "financial", "cos"],
        gateConditions: ["Invoice number present", "Invoice date present"],
        responsibleRole: "Financial Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "revenue-milestone-logic", title: "Revenue Milestone Logic", category: "governance",
        contentMarkdown: "# Revenue Milestone Logic\n\nDefines how revenue is recognised against project milestones.\n\n## Process\n1. Revenue Recognition Amount extracted from 'REVENUE RECOGNITION AMOUNT' column in Expenditure Breakdown sheet\n2. Stored in `program_expense.revenue_amount`\n3. Aggregated at project level for revenue tracking\n\n## Milestone Gates\n- Revenue can only be recognised when corresponding deliverables are certified\n- CP (Completion Point) triggers revenue milestone acceptance\n- VO (Variation Orders) require separate approval before revenue adjustment\n\n## Reporting\n- Revenue tracker shows project-level totals\n- Monthly revenue recognition aligned to COS realisation periods",
        tags: ["governance", "financial", "revenue"],
        gateConditions: ["Deliverable certified", "CP triggered", "Client acceptance received"],
        responsibleRole: "Financial Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "vo-approval-workflow", title: "VO Approval Workflow", category: "governance",
        contentMarkdown: "# VO Approval Workflow\n\nVariation Order approval process for scope changes on active projects.\n\n## Workflow Steps\n1. **VO Identification** — PM identifies scope change requirement\n2. **Cost Estimation** — Engineering and procurement provide cost impact\n3. **Internal Review** — PM prepares VO package with technical justification\n4. **COO Approval** — COO reviews financial impact and approves/rejects\n5. **Client Submission** — VO submitted to client for approval\n6. **Client Approval** — Client signs off on VO\n7. **Costed Update** — Project costed amounts updated via Smart Import re-run\n8. **Revenue Adjustment** — Revenue milestones updated if applicable\n\n## Blocking Conditions\n- No VO work may commence before internal COO approval\n- No revenue may be recognised on unapproved VOs\n- Costed amounts must be updated before COS tracking applies to VO lines",
        tags: ["governance", "financial", "variation"],
        gateConditions: ["COO internal approval", "Client written approval", "Costed updated in system"],
        blockingConditions: ["No work before COO approval", "No revenue on unapproved VOs"],
        responsibleRole: "Project Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "cashflow-forecasting-model", title: "Cashflow Forecasting Model", category: "governance",
        contentMarkdown: "# Cashflow Forecasting Model\n\nCashflow projection and tracking model for Emergent Energy projects.\n\n## Outflow Classification\n\n### Out of Bank\nPayment date font is BLACK + has invoice number\n- `paymentDateBlack && hasInvoice`\n- Money has left the bank account\n\n### Payment Planned\nPayment date exists but font is RED\n- Payment scheduled but not yet executed\n\n### Planned\nNo payment date or insufficient data\n- Future obligation, not yet scheduled\n\n## Forecasting\n- Forecast payment dates extracted from costed section of Expenditure Breakdown\n- `computedForecastPaymentDate` derived from `forecast_payment_date` column\n- 30/60/90 day payment windows for cash planning\n\n## Font Color Rule\nSame as COS — only explicit BLACK font means confirmed payment. NULL/empty = not confirmed.",
        tags: ["governance", "financial", "cashflow"],
        responsibleRole: "Financial Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "risk-register-governance", title: "Risk Register Governance", category: "governance",
        contentMarkdown: "# Risk Register Governance\n\nRisk management framework aligned to Emergent Energy execution structure.\n\n## Risk Categories\n- **Financial** — Cost overruns, payment delays, currency exposure\n- **Schedule** — Programme delays, resource availability, long-lead items\n- **Technical** — Design errors, specification changes, integration issues\n- **HSE** — Safety incidents, environmental non-compliance\n- **Contractual** — Scope disputes, VO delays, penalty clauses\n- **Supply Chain** — Subcontractor performance, material shortages\n\n## Risk Assessment\n- Likelihood x Impact matrix (5x5)\n- RAG status assignment per risk\n- Monthly risk review in Weekly Review Wizard\n\n## Escalation\n- High/Critical risks escalated to COO within 24 hours\n- Risk mitigations tracked as TR Register items",
        tags: ["governance", "risk"],
        responsibleRole: "Project Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "safety-governance", title: "Safety Governance", category: "governance",
        contentMarkdown: "# Safety Governance\n\nHealth, Safety and Environmental governance for Emergent Energy projects.\n\n## Framework\n- HSE Plan required before site mobilisation\n- Daily toolbox talks and site safety briefings\n- Incident reporting within 24 hours\n- Near-miss reporting encouraged and tracked\n\n## Gate Conditions\n- HSE Plan approved before construction commencement\n- All personnel inducted before site access\n- PPE compliance verified daily\n- Emergency response plan in place\n\n## Reporting\n- Monthly HSE statistics (LTI, TRIR, near-miss rate)\n- Incident investigations with root cause analysis\n- Corrective actions tracked through TR Register",
        tags: ["governance", "safety", "hse"],
        gateConditions: ["HSE Plan approved", "Personnel inducted", "PPE compliance verified", "Emergency response plan active"],
        blockingConditions: ["No site access without induction", "Stop work authority for safety violations"],
        responsibleRole: "Construction Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "qa-governance", title: "QA Governance", category: "governance",
        contentMarkdown: "# QA Governance\n\nQuality Assurance governance aligned to current execution structure.\n\n## Quality Framework\n- Inspection and Test Plans (ITPs) for all critical activities\n- Hold points requiring witness/sign-off before proceeding\n- Non-Conformance Reports (NCRs) tracked and closed out\n- Quality Dashboard provides real-time compliance visibility\n\n## Role Split\n- **Design Engineer** — Technical quality of engineering deliverables\n- **Project Engineer (Quality)** — Execution quality, ITP management, site inspections\n- **Construction Manager** — Installation quality and workmanship\n\n## Gate Conditions\n- ITP approved before work commences\n- Hold points witnessed and signed off\n- All NCRs closed before handover\n- As-built documentation complete",
        tags: ["governance", "quality"],
        gateConditions: ["ITP approved", "Hold points witnessed", "NCRs closed", "As-built documentation complete"],
        responsibleRole: "Project Engineer (Quality)",
        escalationRole: "Engineering Manager",
      });

      await upsertNode({
        slug: "company-lifecycle-phase", title: "Company Lifecycle Phase", category: "process",
        contentMarkdown: "# Company Lifecycle Phase\n\nRestricted-visibility lifecycle phases that govern company-level project progression.\n\n## Phases\n1. **Opportunity** — Deal identification and initial assessment\n2. **Tender** — Formal tender preparation and submission\n3. **Award** — Contract award and negotiation\n4. **Execution** — Active project delivery (see [[Execution Phase]])\n5. **Close-out** — Project completion and financial close\n6. **O&M** — Operations and Maintenance transfer (see [[Matriarch O&M Transfer]])\n\n## Visibility\n- **Restricted** to COO, CEO, and Admin roles\n- PM-level users see only Execution Phase details\n- Lifecycle transitions require COO approval\n\n## Lifecycle Board\nManaged via the Company Lifecycle Dashboard in the Emergent Energy Web Application.",
        tags: ["process", "lifecycle", "restricted"],
        flowEnabled: true,
        gateConditions: ["COO approval for phase transitions"],
        responsibleRole: "COO",
      });

      await upsertNode({
        slug: "execution-phase", title: "Execution Phase", category: "process",
        contentMarkdown: "# Execution Phase\n\nPM-visible project execution phase covering active delivery.\n\n## Sub-phases\n1. **Mobilisation** — Site setup, team deployment, HSE plan activation\n2. **Engineering** — Design completion, CP-triggered execution release\n3. **Procurement** — Material ordering, subcontractor appointment\n4. **Construction** — On-site installation and build\n5. **Commissioning** — Testing, energisation, performance verification\n6. **Handover** — Client handover and documentation transfer (see [[Handover and Matriarch O&M Transfer]])\n\n## CP-Triggered Execution\n- Engineering design release gated by Completion Points (CPs)\n- Each CP validates that design deliverables meet quality requirements\n- Construction cannot commence on a work package until its CP is approved\n\n## Visibility\n- Visible to PM, Engineering, and Construction roles\n- Sub-phase transitions tracked on Execution Board",
        tags: ["process", "execution", "pm-visible"],
        flowEnabled: true,
        gateConditions: ["CP approval before construction", "HSE plan active", "Procurement complete for work package"],
        responsibleRole: "Project Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "handover-and-matriarch-om-transfer", title: "Handover and Matriarch O&M Transfer", category: "process",
        contentMarkdown: "# Handover and Matriarch O&M Transfer\n\nFormalised handover process and O&M system transfer requirements.\n\n## Handover Requirements\n1. **Documentation Package**\n   - As-built drawings signed off\n   - Test certificates and commissioning reports\n   - O&M manuals delivered\n   - Warranty certificates collated\n   - Training records for client personnel\n\n2. **Quality Sign-off**\n   - All NCRs closed out\n   - Punch list items complete (zero Category A items)\n   - Final ITP sign-off\n\n3. **Financial Close-out**\n   - Final account agreed with client\n   - All VOs settled\n   - Retention terms documented\n   - Final COS reconciliation complete\n\n## Matriarch O&M Transfer\n- Asset register exported to Matriarch system\n- Maintenance schedules configured\n- Spare parts inventory transferred\n- Monitoring system handover (if applicable)\n- O&M contract terms activated\n\n## Gate Conditions\n- Client acceptance certificate signed\n- All punch list items resolved\n- Financial reconciliation complete\n- Matriarch system configured and tested",
        tags: ["process", "handover", "o&m"],
        flowEnabled: true,
        gateConditions: ["Client acceptance certificate", "Punch list complete", "Financial reconciliation done", "Matriarch O&M configured"],
        blockingConditions: ["No handover with open Category A punch items", "No O&M transfer without Matriarch configuration"],
        responsibleRole: "Project Manager",
        escalationRole: "COO",
      });

      await upsertNode({
        slug: "design-engineer", title: "Design Engineer", category: "role",
        contentMarkdown: "# Design Engineer\n\nResponsible for technical design quality of engineering deliverables.\n\n## Responsibilities\n- Electrical and structural design calculations\n- Drawing production and review\n- Technical specification development\n- Design verification and CP preparation\n- RFI response and technical support to site\n- Interface with Design Review (Red Team) process\n\n## Reports To\n[[Engineering Manager]]\n\n## Interfaces With\n- [[Project Engineer (Quality)]] — design quality review\n- [[Construction Manager]] — technical queries from site\n- [[Procurement]] — technical specifications for materials",
        tags: ["role", "engineering", "design"],
        responsibleRole: "Design Engineer",
      });

      await upsertNode({
        slug: "project-engineer-quality", title: "Project Engineer (Quality)", category: "role",
        contentMarkdown: "# Project Engineer (Quality)\n\nResponsible for execution quality, ITP management, and site inspection oversight.\n\n## Responsibilities\n- Inspection and Test Plan (ITP) development and management\n- Quality inspection scheduling and execution\n- Non-Conformance Report (NCR) management\n- Hold point witness and sign-off coordination\n- Quality documentation for handover package\n- Supplier quality assessments\n\n## Reports To\n[[Engineering Manager]]\n\n## Interfaces With\n- [[Design Engineer]] — design quality inputs\n- [[Construction Manager]] — site quality inspections\n- [[QA Governance]] — quality framework compliance",
        tags: ["role", "engineering", "quality"],
        responsibleRole: "Project Engineer (Quality)",
      });

      const edgePairs = [
        ["construction-manager", "handover-and-matriarch-om-transfer"],
        ["construction-manager", "safety-governance"],
        ["design-engineer", "project-engineer-quality"],
        ["execution-phase", "handover-and-matriarch-om-transfer"],
        ["company-lifecycle-phase", "execution-phase"],
        ["cos-realisation-logic", "cashflow-forecasting-model"],
        ["vo-approval-workflow", "revenue-milestone-logic"],
        ["vo-approval-workflow", "cos-realisation-logic"],
        ["qa-governance", "handover-and-matriarch-om-transfer"],
        ["safety-governance", "execution-phase"],
        ["risk-register-governance", "execution-phase"],
        ["emergent-energy-web-application", "cos-realisation-logic"],
        ["emergent-energy-web-application", "cashflow-forecasting-model"],
        ["emergent-energy-web-application", "revenue-milestone-logic"],
      ];

      for (const [from, to] of edgePairs) {
        await ensureEdge(from, to);
      }

      console.log(`[EE-Info] Post-seed alignment complete: ${created.length} created, ${updated.length} updated`);
      res.json({ success: true, created, updated, skipped });
    } catch (err) {
      console.error("[EE-Info] Error in post-seed alignment:", err);
      res.status(500).json({ error: "Failed to run post-seed alignment" });
    }
  });

  const OS_LIFECYCLE_STAGES = [
    { slug: "os-p0-first-assessment", title: "First Assessment (P0)", sortOrder: 1, description: "Initial project evaluation and feasibility assessment" },
    { slug: "os-p1-cost-proposal", title: "Cost Proposal (P1)", sortOrder: 2, description: "Detailed costing, design proposals, and client engagement" },
    { slug: "os-p2-planning", title: "Planning & Handover (P2/P3)", sortOrder: 3, description: "PD/PM handover, financial close, and project planning" },
    { slug: "os-p4-construction", title: "Construction (P4)", sortOrder: 4, description: "Installation, site management, and construction execution" },
    { slug: "os-p5-commissioning", title: "Commissioning & QA (P5)", sortOrder: 5, description: "Quality assurance, testing, and commissioning" },
    { slug: "os-p6-handover", title: "Handover (P6)", sortOrder: 6, description: "Client handover and defect liability period" },
    { slug: "os-p7-closeout", title: "Closeout (P7)", sortOrder: 7, description: "Commercial close-out and post-mortem review" },
  ];

  const OS_DEPARTMENTS = [
    { slug: "os-dept-exco", title: "Exco", sortOrder: 0, description: "Executive Committee - Strategic leadership and governance", parent: null },
    { slug: "os-dept-engineering", title: "Engineering", sortOrder: 1, description: "Design, technical calculations, and engineering deliverables", parent: null },
    { slug: "os-dept-finance", title: "Finance", sortOrder: 2, description: "Financial management, invoicing, and cost tracking", parent: null },
    { slug: "os-dept-project-management", title: "Project Management", sortOrder: 3, description: "Project delivery, construction oversight, planning, and handover management", parent: null },
    { slug: "os-dept-project-development", title: "Project Development", sortOrder: 4, description: "Business development, client relations, and deal management", parent: null },
    { slug: "os-dept-quality", title: "Quality", sortOrder: 5, description: "Quality assurance, compliance, and standards management", parent: null },
    { slug: "os-dept-legal", title: "Legal", sortOrder: 1, description: "Contracts, compliance, and legal affairs", parent: "os-dept-exco" },
    { slug: "os-dept-procurement", title: "Procurement", sortOrder: 21, description: "Supplier management and material sourcing", parent: "os-dept-finance" },
    { slug: "os-dept-operations", title: "Operations", sortOrder: 31, description: "Day-to-day operational management", parent: "os-dept-project-management" },
    { slug: "os-dept-project-delivery", title: "Project Delivery", sortOrder: 32, description: "On-site project execution and management", parent: "os-dept-project-management" },
    { slug: "os-dept-om", title: "O&M", sortOrder: 33, description: "Operations and maintenance of completed projects", parent: "os-dept-project-management" },
    { slug: "os-dept-sales", title: "Sales", sortOrder: 41, description: "Business development and client relations", parent: "os-dept-project-development" },
    { slug: "os-dept-hr", title: "HR", sortOrder: 42, description: "Human resources and people management", parent: "os-dept-project-development" },
  ];

  app.post("/api/ee-info/os/seed", requireCOO, async (_req, res) => {
    try {
      const existing = await db.select({ slug: eeInfoNodes.slug }).from(eeInfoNodes)
        .where(or(
          sql`${eeInfoNodes.nodeType} = 'lifecycle_stage'`,
          sql`${eeInfoNodes.nodeType} = 'department'`
        ));
      const existingSlugs = new Set(existing.map(n => n.slug));
      const created: string[] = [];
      const skipped: string[] = [];

      for (const stage of OS_LIFECYCLE_STAGES) {
        if (existingSlugs.has(stage.slug)) { skipped.push(stage.slug); continue; }
        await db.insert(eeInfoNodes).values({
          id: generateId(), slug: stage.slug, title: stage.title,
          contentMarkdown: `# ${stage.title}\n\n${stage.description}`,
          status: "published", category: "process", nodeType: "lifecycle_stage",
          sortOrder: stage.sortOrder, tags: ["lifecycle", "os-map"],
        });
        created.push(stage.slug);
      }

      const deptIdMap: Record<string, string> = {};
      for (const dept of OS_DEPARTMENTS.filter(d => !d.parent)) {
        if (existingSlugs.has(dept.slug)) {
          const ex = await db.select({ id: eeInfoNodes.id }).from(eeInfoNodes).where(sql`${eeInfoNodes.slug} = ${dept.slug}`);
          if (ex.length > 0) deptIdMap[dept.slug] = ex[0].id;
          skipped.push(dept.slug); continue;
        }
        const id = generateId();
        deptIdMap[dept.slug] = id;
        await db.insert(eeInfoNodes).values({
          id, slug: dept.slug, title: dept.title,
          contentMarkdown: `# ${dept.title}\n\n${dept.description}`,
          status: "published", category: "process", nodeType: "department",
          sortOrder: dept.sortOrder, tags: ["department", "os-map"],
        });
        created.push(dept.slug);
      }
      for (const dept of OS_DEPARTMENTS.filter(d => d.parent)) {
        if (existingSlugs.has(dept.slug)) { skipped.push(dept.slug); continue; }
        const parentId = deptIdMap[dept.parent!] || null;
        await db.insert(eeInfoNodes).values({
          id: generateId(), slug: dept.slug, title: dept.title,
          contentMarkdown: `# ${dept.title}\n\n${dept.description}`,
          status: "published", category: "process", nodeType: "department",
          sortOrder: dept.sortOrder, tags: ["department", "os-map", "sub-department"],
          parentNodeId: parentId,
        });
        created.push(dept.slug);
      }

      const allProcessNodes = await db.select().from(eeInfoNodes)
        .where(and(
          sql`${eeInfoNodes.category} = 'process'`,
          sql`${eeInfoNodes.nodeType} = 'content'`
        ));
      let mapped = 0;
      for (const node of allProcessNodes) {
        const title = node.title.toLowerCase();
        const content = (node.contentMarkdown || "").toLowerCase();
        let deptSlug: string | null = null;
        const stages: string[] = [];

        if (/epd\d|engineer.*pack|red.team|data.tool|tender.*request|site.*visit.*request/i.test(title)) deptSlug = "os-dept-engineering";
        else if (/epm\d|engineer|design|ifc|drawing|bom|technical/i.test(title + content)) deptSlug = "os-dept-engineering";
        else if (/pma\d|financ|invoice|cost|budget|revenue|cashflow|payment|inventory|smart.import|procurement/i.test(title + content)) deptSlug = "os-dept-finance";
        else if (/pm\d|construct|install|commission|planning.*pm|hse|hand.over|pdpm|project.initiation|compliance/i.test(title)) deptSlug = "os-dept-project-management";
        else if (/pd\d|deal.clos|first.engagement|relationship|research.*client|final.offer|client.invoic/i.test(title + content)) deptSlug = "os-dept-project-development";
        else if (/quality|qa|qc|inspection|audit/i.test(title + content)) deptSlug = "os-dept-quality";
        else if (/executive|coo|ceo|strategic|legal|contract/i.test(title + content)) deptSlug = "os-dept-exco";
        else deptSlug = "os-dept-project-management";

        if (/first assessment|feasibility|p0|epd1/i.test(title + content)) stages.push("os-p0-first-assessment");
        if (/cost proposal|design proposal|p1|epd2/i.test(title + content)) stages.push("os-p1-cost-proposal");
        if (/planning|handover|financial close|p2|p3/i.test(title + content)) stages.push("os-p2-planning");
        if (/construct|install|p4/i.test(title + content)) stages.push("os-p4-construction");
        if (/commission|qa|quality|p5/i.test(title + content)) stages.push("os-p5-commissioning");
        if (/handover|dlp|p6/i.test(title + content)) stages.push("os-p6-handover");
        if (/closeout|post-mortem|p7/i.test(title + content)) stages.push("os-p7-closeout");

        if (deptSlug || stages.length > 0) {
          await db.update(eeInfoNodes)
            .set({
              nodeType: "process",
              departmentSlug: deptSlug || undefined,
              lifecycleStages: stages.length > 0 ? stages : undefined,
              updatedAt: new Date(),
            })
            .where(eq(eeInfoNodes.id, node.id));
          mapped++;
        }
      }

      const toolNodes = await db.select().from(eeInfoNodes)
        .where(and(
          sql`${eeInfoNodes.category} = 'tool'`,
          sql`${eeInfoNodes.nodeType} = 'content'`
        ));
      for (const node of toolNodes) {
        await db.update(eeInfoNodes).set({ nodeType: "tool", updatedAt: new Date() }).where(eq(eeInfoNodes.id, node.id));
      }

      const templateNodes = await db.select().from(eeInfoNodes)
        .where(and(
          sql`${eeInfoNodes.category} = 'template'`,
          sql`${eeInfoNodes.nodeType} = 'content'`
        ));
      for (const node of templateNodes) {
        await db.update(eeInfoNodes).set({ nodeType: "template", updatedAt: new Date() }).where(eq(eeInfoNodes.id, node.id));
      }

      res.json({
        success: true,
        created,
        skipped,
        processNodesMapped: mapped,
        toolNodesMapped: toolNodes.length,
        templateNodesMapped: templateNodes.length,
      });
    } catch (err) {
      console.error("[EE-Info OS] Seed error:", err);
      res.status(500).json({ error: "Failed to seed OS map data" });
    }
  });

  app.get("/api/ee-info/os/lifecycle", requireAuth, async (_req, res) => {
    try {
      const stages = await db.select().from(eeInfoNodes)
        .where(sql`${eeInfoNodes.nodeType} = 'lifecycle_stage'`)
        .orderBy(eeInfoNodes.sortOrder);

      const processes = await db.select().from(eeInfoNodes)
        .where(sql`${eeInfoNodes.nodeType} = 'process'`);

      const departments = await db.select().from(eeInfoNodes)
        .where(sql`${eeInfoNodes.nodeType} = 'department'`)
        .orderBy(eeInfoNodes.sortOrder);

      const stagesWithData = stages.map(stage => {
        const stageProcesses = processes.filter(p =>
          Array.isArray(p.lifecycleStages) && (p.lifecycleStages as string[]).includes(stage.slug)
        );
        const deptSlugs = [...new Set(stageProcesses.map(p => p.departmentSlug).filter(Boolean))];
        const stageDepts = departments.filter(d => deptSlugs.includes(d.slug));
        return {
          ...stage,
          processes: stageProcesses.map(p => ({ id: p.id, slug: p.slug, title: p.title, status: p.status, departmentSlug: p.departmentSlug })),
          departments: stageDepts.map(d => ({ id: d.id, slug: d.slug, title: d.title })),
        };
      });

      const mainDepartments = departments.filter(d => !d.parentNodeId);
      res.json({ stages: stagesWithData, allDepartments: mainDepartments, totalProcesses: processes.length });
    } catch (err) {
      console.error("[EE-Info OS] Lifecycle error:", err);
      res.status(500).json({ error: "Failed to fetch lifecycle data" });
    }
  });

  app.get("/api/ee-info/os/departments", requireAuth, async (_req, res) => {
    try {
      const allDepartments = await db.select().from(eeInfoNodes)
        .where(sql`${eeInfoNodes.nodeType} = 'department'`)
        .orderBy(eeInfoNodes.sortOrder);

      const processes = await db.select().from(eeInfoNodes)
        .where(sql`${eeInfoNodes.nodeType} = 'process'`);

      const mainDepts = allDepartments.filter(d => !d.parentNodeId);
      const subDepts = allDepartments.filter(d => !!d.parentNodeId);

      const result = mainDepts.map(dept => {
        const children = subDepts.filter(sd => sd.parentNodeId === dept.id);
        const childSlugs = children.map(c => c.slug);
        const allSlugs = [dept.slug, ...childSlugs];
        const deptProcesses = processes.filter(p => allSlugs.includes(p.departmentSlug || ""));
        return {
          ...dept,
          processCount: deptProcesses.length,
          activeProcesses: deptProcesses.filter(p => p.status === "published").length,
          draftProcesses: deptProcesses.filter(p => p.status === "draft" || p.status === "stub").length,
          subDepartments: children.map(c => {
            const cProcs = processes.filter(p => p.departmentSlug === c.slug);
            return {
              ...c,
              processCount: cProcs.length,
              activeProcesses: cProcs.filter(p => p.status === "published").length,
            };
          }),
        };
      });
      res.json(result);
    } catch (err) {
      console.error("[EE-Info OS] Departments error:", err);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  });

  app.get("/api/ee-info/os/departments/:slug", requireAuth, async (req, res) => {
    try {
      const dept = await db.select().from(eeInfoNodes)
        .where(and(eq(eeInfoNodes.slug, req.params.slug), sql`${eeInfoNodes.nodeType} = 'department'`))
        .limit(1);
      if (!dept.length) return res.status(404).json({ error: "Department not found" });

      const processes = await db.select().from(eeInfoNodes)
        .where(and(
          sql`${eeInfoNodes.nodeType} = 'process'`,
          eq(eeInfoNodes.departmentSlug, req.params.slug)
        ))
        .orderBy(eeInfoNodes.sortOrder);

      const stages = await db.select().from(eeInfoNodes)
        .where(sql`${eeInfoNodes.nodeType} = 'lifecycle_stage'`)
        .orderBy(eeInfoNodes.sortOrder);

      const grouped: Record<string, any[]> = {};
      const ungrouped: any[] = [];
      for (const proc of processes) {
        const procStages = Array.isArray(proc.lifecycleStages) ? (proc.lifecycleStages as string[]) : [];
        if (procStages.length === 0) { ungrouped.push(proc); continue; }
        for (const stageSlug of procStages) {
          if (!grouped[stageSlug]) grouped[stageSlug] = [];
          grouped[stageSlug].push(proc);
        }
      }

      const stageGroups = stages
        .filter(s => grouped[s.slug])
        .map(s => ({ stage: { id: s.id, slug: s.slug, title: s.title }, processes: grouped[s.slug] }));
      if (ungrouped.length > 0) {
        stageGroups.push({ stage: { id: "ungrouped", slug: "ungrouped", title: "General" }, processes: ungrouped });
      }

      const edges = await db.select().from(eeInfoEdges)
        .where(or(
          inArray(eeInfoEdges.fromNodeId, processes.map(p => p.id)),
          inArray(eeInfoEdges.toNodeId, processes.map(p => p.id)),
        ));

      res.json({ department: dept[0], stageGroups, edges, totalProcesses: processes.length });
    } catch (err) {
      console.error("[EE-Info OS] Department detail error:", err);
      res.status(500).json({ error: "Failed to fetch department detail" });
    }
  });

  app.get("/api/ee-info/os/processes/:slug", requireAuth, async (req, res) => {
    try {
      const proc = await db.select().from(eeInfoNodes)
        .where(eq(eeInfoNodes.slug, req.params.slug))
        .limit(1);
      if (!proc.length) return res.status(404).json({ error: "Process not found" });

      const steps = await db.select().from(eeInfoNodes)
        .where(and(
          eq(eeInfoNodes.parentNodeId, proc[0].id),
          sql`${eeInfoNodes.nodeType} = 'step'`
        ))
        .orderBy(eeInfoNodes.sortOrder);

      const dept = proc[0].departmentSlug
        ? await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, proc[0].departmentSlug)).limit(1)
        : [];

      const stageNodes = Array.isArray(proc[0].lifecycleStages) && (proc[0].lifecycleStages as string[]).length > 0
        ? await db.select().from(eeInfoNodes).where(inArray(eeInfoNodes.slug, proc[0].lifecycleStages as string[]))
        : [];

      const edges = await db.select().from(eeInfoEdges)
        .where(or(eq(eeInfoEdges.fromNodeId, proc[0].id), eq(eeInfoEdges.toNodeId, proc[0].id)));
      const relatedIds = edges.map(e => e.fromNodeId === proc[0].id ? e.toNodeId : e.fromNodeId);
      const relatedNodes = relatedIds.length > 0
        ? await db.select().from(eeInfoNodes).where(inArray(eeInfoNodes.id, relatedIds))
        : [];

      res.json({
        process: proc[0],
        steps,
        department: dept[0] || null,
        lifecycleStages: stageNodes,
        edges,
        relatedProcesses: relatedNodes,
      });
    } catch (err) {
      console.error("[EE-Info OS] Process detail error:", err);
      res.status(500).json({ error: "Failed to fetch process detail" });
    }
  });

  app.get("/api/ee-info/os/templates", requireAuth, async (req, res) => {
    try {
      const search = (req.query.search as string) || "";
      const where = search
        ? and(sql`${eeInfoNodes.nodeType} IN ('template')`, ilike(eeInfoNodes.title, `%${search}%`))
        : sql`${eeInfoNodes.nodeType} IN ('template')`;

      const templates = await db.select().from(eeInfoNodes).where(where).orderBy(eeInfoNodes.title);

      const processLinks: Record<string, { slug: string; title: string }[]> = {};
      if (templates.length > 0) {
        const templateIds = templates.map(t => t.id);
        const edges = await db.select().from(eeInfoEdges)
          .where(or(
            inArray(eeInfoEdges.fromNodeId, templateIds),
            inArray(eeInfoEdges.toNodeId, templateIds),
          ));
        const linkedIds = new Set<string>();
        for (const e of edges) {
          if (templateIds.includes(e.fromNodeId)) linkedIds.add(e.toNodeId);
          else linkedIds.add(e.fromNodeId);
        }
        if (linkedIds.size > 0) {
          const linkedNodes = await db.select().from(eeInfoNodes)
            .where(and(
              inArray(eeInfoNodes.id, [...linkedIds]),
              sql`${eeInfoNodes.nodeType} = 'process'`
            ));
          for (const e of edges) {
            const templateId = templateIds.includes(e.fromNodeId) ? e.fromNodeId : e.toNodeId;
            const otherId = templateId === e.fromNodeId ? e.toNodeId : e.fromNodeId;
            const linked = linkedNodes.find(n => n.id === otherId);
            if (linked) {
              if (!processLinks[templateId]) processLinks[templateId] = [];
              processLinks[templateId].push({ slug: linked.slug, title: linked.title });
            }
          }
        }
      }

      res.json(templates.map(t => ({
        ...t,
        linkedProcesses: processLinks[t.id] || [],
      })));
    } catch (err) {
      console.error("[EE-Info OS] Templates error:", err);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  app.post("/api/ee-info/os/processes", requireCOO, async (req, res) => {
    try {
      const { title, departmentSlug, lifecycleStages } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required" });

      const slug = slugify(title);
      const existing = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, slug)).limit(1);
      if (existing.length) return res.status(409).json({ error: "A process with this name already exists" });

      const id = generateId();
      await db.insert(eeInfoNodes).values({
        id, slug, title,
        contentMarkdown: `# ${title}\n\n*Process shell — to be documented.*`,
        status: "draft", category: "process", nodeType: "process",
        departmentSlug: departmentSlug || null,
        lifecycleStages: lifecycleStages || [],
        tags: ["os-map", "process"],
        createdBy: (req.user as any)?.name || "system",
        updatedBy: (req.user as any)?.name || "system",
      });

      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, id)).limit(1);
      res.json(node[0]);
    } catch (err) {
      console.error("[EE-Info OS] Create process error:", err);
      res.status(500).json({ error: "Failed to create process" });
    }
  });

  app.post("/api/ee-info/os/processes/:slug/sop", requireCOO, async (req, res) => {
    try {
      const proc = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.slug, req.params.slug)).limit(1);
      if (!proc.length) return res.status(404).json({ error: "Process not found" });

      const sopTemplate = {
        purpose: "",
        triggers: [],
        inputs: [],
        outputs: [],
        raci: [],
        tools: [],
        templates: [],
        reviewCadence: "Quarterly",
      };

      const sopMarkdown = `# ${proc[0].title} — Standard Operating Procedure\n\n## Purpose\n*Define the purpose of this process.*\n\n## Triggers\n- *What initiates this process?*\n\n## Inputs\n- *What inputs are required?*\n\n## Steps\n1. *Step 1*\n2. *Step 2*\n3. *Step 3*\n\n## Outputs\n- *What does this process produce?*\n\n## RACI\n| Role | R | A | C | I |\n|------|---|---|---|---|\n| *Role* | | | | |\n\n## Tools\n- *List tools used*\n\n## Templates\n- *List templates used*\n\n## Review Cadence\nQuarterly`;

      await db.update(eeInfoNodes)
        .set({
          sopData: sopTemplate,
          contentMarkdown: sopMarkdown,
          status: "draft",
          updatedAt: new Date(),
          updatedBy: (req.user as any)?.name || "system",
        })
        .where(eq(eeInfoNodes.id, proc[0].id));

      const updated = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, proc[0].id)).limit(1);
      res.json(updated[0]);
    } catch (err) {
      console.error("[EE-Info OS] Create SOP error:", err);
      res.status(500).json({ error: "Failed to create SOP shell" });
    }
  });

  app.put("/api/ee-info/os/nodes/:id", requireCOO, async (req, res) => {
    try {
      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, req.params.id)).limit(1);
      if (!node.length) return res.status(404).json({ error: "Node not found" });

      const { title, contentMarkdown, status, departmentSlug, lifecycleStages, sopData, sortOrder, externalUrl, tags } = req.body;
      const updates: any = { updatedAt: new Date(), updatedBy: (req.user as any)?.name || "system" };
      if (title !== undefined) updates.title = title;
      if (contentMarkdown !== undefined) {
        await db.insert(eeInfoVersions).values({
          id: generateId(), nodeId: node[0].id,
          contentMarkdown: node[0].contentMarkdown,
          changedBy: (req.user as any)?.name || "system",
          changeNote: "Content updated via OS map",
        });
        updates.contentMarkdown = contentMarkdown;
      }
      if (status !== undefined) updates.status = status;
      if (departmentSlug !== undefined) updates.departmentSlug = departmentSlug;
      if (lifecycleStages !== undefined) updates.lifecycleStages = lifecycleStages;
      if (sopData !== undefined) updates.sopData = sopData;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (externalUrl !== undefined) updates.externalUrl = externalUrl;
      if (tags !== undefined) updates.tags = tags;

      await db.update(eeInfoNodes).set(updates).where(eq(eeInfoNodes.id, req.params.id));
      const updated = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, req.params.id)).limit(1);
      res.json(updated[0]);
    } catch (err) {
      console.error("[EE-Info OS] Update node error:", err);
      res.status(500).json({ error: "Failed to update node" });
    }
  });

  app.post("/api/ee-info/os/processes/:processId/steps", requireCOO, async (req, res) => {
    try {
      const { title, description, sortOrder: order } = req.body;
      if (!title) return res.status(400).json({ error: "Step title is required" });

      const slug = slugify(title) + "-step-" + Date.now().toString(36);
      const id = generateId();
      await db.insert(eeInfoNodes).values({
        id, slug, title,
        contentMarkdown: description || "",
        status: "published", category: "process", nodeType: "step",
        parentNodeId: req.params.processId,
        sortOrder: order || 0,
        tags: ["step", "os-map"],
        createdBy: (req.user as any)?.name || "system",
        updatedBy: (req.user as any)?.name || "system",
      });

      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, id)).limit(1);
      res.json(node[0]);
    } catch (err) {
      console.error("[EE-Info OS] Create step error:", err);
      res.status(500).json({ error: "Failed to create step" });
    }
  });

  app.delete("/api/ee-info/os/nodes/:id", requireCOO, async (req, res) => {
    try {
      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, req.params.id)).limit(1);
      if (!node.length) return res.status(404).json({ error: "Node not found" });

      await db.delete(eeInfoEdges).where(or(
        eq(eeInfoEdges.fromNodeId, req.params.id),
        eq(eeInfoEdges.toNodeId, req.params.id),
      ));
      await db.delete(eeInfoNodes).where(eq(eeInfoNodes.parentNodeId, req.params.id));
      await db.delete(eeInfoNodes).where(eq(eeInfoNodes.id, req.params.id));

      res.json({ success: true });
    } catch (err) {
      console.error("[EE-Info OS] Delete error:", err);
      res.status(500).json({ error: "Failed to delete node" });
    }
  });

  const isEditorForNode = async (nodeId: string, userId: number): Promise<boolean> => {
    const editors = await db.select().from(eeInfoNodeEditors)
      .where(and(eq(eeInfoNodeEditors.nodeId, nodeId), eq(eeInfoNodeEditors.userId, userId), eq(eeInfoNodeEditors.canEdit, true)));
    return editors.length > 0;
  };

  const isCOORole = (user: any): boolean => {
    const role = user?.role || user?.companyRole;
    return role === "COO_ADMIN" || role === "admin" || role === "CEO_ADMIN";
  };

  app.get("/api/ee-info/nodes/:nodeId/details", requireAuth, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const details = await db.select().from(eeInfoNodeDetails).where(eq(eeInfoNodeDetails.nodeId, nodeId));
      res.json(details[0] || null);
    } catch (err) {
      console.error("[EE-Info] Error fetching node details:", err);
      res.status(500).json({ error: "Failed to fetch node details" });
    }
  });

  app.put("/api/ee-info/nodes/:nodeId/details", requireAuth, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const user = req.user as any;
      const userId = user?.id;

      if (!isCOORole(user)) {
        const canEdit = await isEditorForNode(nodeId, userId);
        if (!canEdit) return res.status(403).json({ error: "forbidden", message: "You do not have permission to edit this node's details" });
      }

      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, nodeId)).limit(1);
      if (!node.length) return res.status(404).json({ error: "Node not found" });

      const { purpose, inputs, steps, outputs, raci, toolsDocs, risksFailureModes } = req.body;

      const existing = await db.select().from(eeInfoNodeDetails).where(eq(eeInfoNodeDetails.nodeId, nodeId));

      if (existing.length > 0) {
        const updates: any = { updatedAt: new Date(), updatedBy: user?.name || String(userId) };
        if (purpose !== undefined) updates.purpose = purpose;
        if (inputs !== undefined) updates.inputs = inputs;
        if (steps !== undefined) updates.steps = steps;
        if (outputs !== undefined) updates.outputs = outputs;
        if (raci !== undefined) updates.raci = raci;
        if (toolsDocs !== undefined) updates.toolsDocs = toolsDocs;
        if (risksFailureModes !== undefined) updates.risksFailureModes = risksFailureModes;

        await db.update(eeInfoNodeDetails).set(updates).where(eq(eeInfoNodeDetails.nodeId, nodeId));
        const [updated] = await db.select().from(eeInfoNodeDetails).where(eq(eeInfoNodeDetails.nodeId, nodeId));
        res.json(updated);
      } else {
        await db.insert(eeInfoNodeDetails).values({
          nodeId,
          purpose: purpose || null,
          inputs: inputs || null,
          steps: steps || null,
          outputs: outputs || null,
          raci: raci || null,
          toolsDocs: toolsDocs || null,
          risksFailureModes: risksFailureModes || null,
          updatedAt: new Date(),
          updatedBy: user?.name || String(userId),
        });
        const [created] = await db.select().from(eeInfoNodeDetails).where(eq(eeInfoNodeDetails.nodeId, nodeId));
        res.json(created);
      }
    } catch (err) {
      console.error("[EE-Info] Error updating node details:", err);
      res.status(500).json({ error: "Failed to update node details" });
    }
  });

  app.get("/api/ee-info/nodes/:nodeId/editors", requireAuth, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const editors = await db.select().from(eeInfoNodeEditors).where(eq(eeInfoNodeEditors.nodeId, nodeId));
      res.json(editors);
    } catch (err) {
      console.error("[EE-Info] Error fetching node editors:", err);
      res.status(500).json({ error: "Failed to fetch node editors" });
    }
  });

  app.post("/api/ee-info/nodes/:nodeId/editors", requireAuth, requireCOO, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { userId, canEdit, canManageChildren } = req.body;
      if (!userId) return res.status(400).json({ error: "userId is required" });

      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, nodeId)).limit(1);
      if (!node.length) return res.status(404).json({ error: "Node not found" });

      const existing = await db.select().from(eeInfoNodeEditors)
        .where(and(eq(eeInfoNodeEditors.nodeId, nodeId), eq(eeInfoNodeEditors.userId, userId)));
      if (existing.length > 0) {
        await db.update(eeInfoNodeEditors).set({
          canEdit: canEdit !== undefined ? canEdit : true,
          canManageChildren: canManageChildren !== undefined ? canManageChildren : false,
        }).where(eq(eeInfoNodeEditors.id, existing[0].id));
        const [updated] = await db.select().from(eeInfoNodeEditors).where(eq(eeInfoNodeEditors.id, existing[0].id));
        return res.json(updated);
      }

      const [created] = await db.insert(eeInfoNodeEditors).values({
        nodeId,
        userId,
        canEdit: canEdit !== undefined ? canEdit : true,
        canManageChildren: canManageChildren !== undefined ? canManageChildren : false,
      }).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("[EE-Info] Error adding node editor:", err);
      res.status(500).json({ error: "Failed to add node editor" });
    }
  });

  app.delete("/api/ee-info/nodes/:nodeId/editors/:editorId", requireAuth, requireCOO, async (req, res) => {
    try {
      const editorId = parseInt(req.params.editorId, 10);
      if (isNaN(editorId)) return res.status(400).json({ error: "Invalid editor ID" });
      await db.delete(eeInfoNodeEditors).where(eq(eeInfoNodeEditors.id, editorId));
      res.json({ success: true });
    } catch (err) {
      console.error("[EE-Info] Error removing node editor:", err);
      res.status(500).json({ error: "Failed to remove node editor" });
    }
  });

  app.get("/api/ee-info/nodes/:nodeId/metrics", requireAuth, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const metrics = await db.select().from(eeInfoNodeMetrics)
        .where(eq(eeInfoNodeMetrics.nodeId, nodeId))
        .orderBy(eeInfoNodeMetrics.sortOrder);
      res.json(metrics);
    } catch (err) {
      console.error("[EE-Info] Error fetching node metrics:", err);
      res.status(500).json({ error: "Failed to fetch node metrics" });
    }
  });

  app.post("/api/ee-info/nodes/:nodeId/metrics", requireAuth, requireCOO, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { metricKey, metricQueryType, config, displayFormat, sortOrder } = req.body;
      if (!metricKey) return res.status(400).json({ error: "metricKey is required" });

      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, nodeId)).limit(1);
      if (!node.length) return res.status(404).json({ error: "Node not found" });

      const [created] = await db.insert(eeInfoNodeMetrics).values({
        nodeId,
        metricKey,
        metricQueryType: metricQueryType || "project_count",
        config: config || null,
        displayFormat: displayFormat || "number",
        sortOrder: sortOrder || 0,
      }).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("[EE-Info] Error adding node metric:", err);
      res.status(500).json({ error: "Failed to add node metric" });
    }
  });

  app.delete("/api/ee-info/nodes/:nodeId/metrics/:metricId", requireAuth, requireCOO, async (req, res) => {
    try {
      const metricId = parseInt(req.params.metricId, 10);
      if (isNaN(metricId)) return res.status(400).json({ error: "Invalid metric ID" });
      await db.delete(eeInfoNodeMetrics).where(eq(eeInfoNodeMetrics.id, metricId));
      res.json({ success: true });
    } catch (err) {
      console.error("[EE-Info] Error removing node metric:", err);
      res.status(500).json({ error: "Failed to remove node metric" });
    }
  });

  const liveMetricsCache = new Map<string, { data: any; expiresAt: number }>();
  const CACHE_TTL_MS = 60_000;

  app.get("/api/ee-info/nodes/:nodeId/metrics/live", requireAuth, async (req, res) => {
    try {
      const { nodeId } = req.params;

      const cached = liveMetricsCache.get(nodeId);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      const metricConfigs = await db.select().from(eeInfoNodeMetrics)
        .where(eq(eeInfoNodeMetrics.nodeId, nodeId))
        .orderBy(eeInfoNodeMetrics.sortOrder);

      if (metricConfigs.length === 0) {
        const emptyResult = { nodeId, metrics: [] };
        liveMetricsCache.set(nodeId, { data: emptyResult, expiresAt: Date.now() + CACHE_TTL_MS });
        return res.json(emptyResult);
      }

      const node = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, nodeId)).limit(1);
      const nodeSlug = node[0]?.slug || "";
      const nodeTitle = node[0]?.title || "";

      const allProjects = await db.select().from(projectInfo);

      const computedMetrics = metricConfigs.map(mc => {
        const cfg = (mc.config as Record<string, any>) || {};
        let value: number | string = 0;

        switch (mc.metricQueryType) {
          case "project_stage": {
            const phaseFilter = cfg.phase || nodeTitle;
            value = allProjects.filter(p => p.isActive && p.phase && p.phase.toLowerCase().includes(phaseFilter.toLowerCase())).length;
            break;
          }
          case "project_count": {
            if (cfg.filter === "overdue") {
              value = allProjects.filter(p => {
                if (!p.isActive) return false;
                if (p.commissioningDate) {
                  const cd = new Date(p.commissioningDate);
                  if (!isNaN(cd.getTime()) && cd < new Date()) return true;
                }
                return false;
              }).length;
            } else if (cfg.filter === "active") {
              value = allProjects.filter(p => p.isActive).length;
            } else if (cfg.phase) {
              value = allProjects.filter(p => p.isActive && p.phase === cfg.phase).length;
            } else {
              value = allProjects.length;
            }
            break;
          }
          case "custom": {
            if (cfg.sumField === "contractValue") {
              value = allProjects.reduce((sum, p) => {
                const v = p.contractValue ? parseFloat(String(p.contractValue)) : 0;
                return sum + (isNaN(v) ? 0 : v);
              }, 0);
            } else {
              value = 0;
            }
            break;
          }
          default:
            value = 0;
        }

        return {
          metricKey: mc.metricKey,
          value,
          displayFormat: mc.displayFormat,
          sortOrder: mc.sortOrder,
        };
      });

      const result = { nodeId, metrics: computedMetrics };
      liveMetricsCache.set(nodeId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      res.json(result);
    } catch (err) {
      console.error("[EE-Info] Error computing live metrics:", err);
      res.status(500).json({ error: "Failed to compute live metrics" });
    }
  });

  app.get("/api/ee-info/story/stages", requireAuth, async (_req, res) => {
    try {
      const stages = await db.select().from(eeInfoNodes)
        .where(and(
          eq(eeInfoNodes.nodeType, "lifecycle_stage"),
          sql`${eeInfoNodes.stageCode} IS NOT NULL AND ${eeInfoNodes.stageCode} != 'DEMO'`
        ))
        .orderBy(eeInfoNodes.sortOrder);

      const allNodes = await db.select({
        id: eeInfoNodes.id,
        parentNodeId: eeInfoNodes.parentNodeId,
        nodeType: eeInfoNodes.nodeType,
        status: eeInfoNodes.status,
      }).from(eeInfoNodes);

      const stagesWithCounts = stages.map(stage => {
        const children = allNodes.filter(n => n.parentNodeId === stage.id);
        const total = children.length;
        const complete = children.filter(c => c.status === "published").length;
        return {
          ...stage,
          childCount: total,
          completedCount: complete,
          progressPct: total > 0 ? Math.round((complete / total) * 100) : 0,
          readyStatus: complete === total && total > 0 ? "Ready" : "In Progress",
        };
      });

      res.json(stagesWithCounts);
    } catch (err) {
      console.error("[EE-Info] Error fetching story stages:", err);
      res.status(500).json({ error: "Failed to fetch story stages" });
    }
  });

  app.get("/api/ee-info/story/node/:id", requireAuth, async (req, res) => {
    try {
      const nodeId = req.params.id;
      const [node] = await db.select().from(eeInfoNodes).where(eq(eeInfoNodes.id, nodeId));
      if (!node) return res.status(404).json({ error: "Node not found" });

      const details = await db.select().from(eeInfoNodeDetails).where(eq(eeInfoNodeDetails.nodeId, nodeId));
      const detail = details[0] || null;

      const edges = await db.select().from(eeInfoEdges)
        .where(or(eq(eeInfoEdges.fromNodeId, nodeId), eq(eeInfoEdges.toNodeId, nodeId)));

      const relatedIds = new Set<string>();
      edges.forEach(e => {
        if (e.fromNodeId !== nodeId) relatedIds.add(e.fromNodeId);
        if (e.toNodeId !== nodeId) relatedIds.add(e.toNodeId);
      });

      let relatedNodes: any[] = [];
      if (relatedIds.size > 0) {
        relatedNodes = await db.select({
          id: eeInfoNodes.id,
          slug: eeInfoNodes.slug,
          title: eeInfoNodes.title,
          nodeType: eeInfoNodes.nodeType,
          category: eeInfoNodes.category,
        }).from(eeInfoNodes).where(inArray(eeInfoNodes.id, Array.from(relatedIds)));
      }

      let nextNode: any = null;
      if (node.nextNodeId) {
        const [n] = await db.select({ id: eeInfoNodes.id, title: eeInfoNodes.title, slug: eeInfoNodes.slug })
          .from(eeInfoNodes).where(eq(eeInfoNodes.id, node.nextNodeId));
        nextNode = n || null;
      }

      let prevNode: any = null;
      const [prev] = await db.select({ id: eeInfoNodes.id, title: eeInfoNodes.title, slug: eeInfoNodes.slug })
        .from(eeInfoNodes).where(eq(eeInfoNodes.nextNodeId, nodeId));
      prevNode = prev || null;

      res.json({
        node,
        detail,
        relatedNodes,
        nextNode,
        prevNode,
        edges,
      });
    } catch (err) {
      console.error("[EE-Info] Error fetching story node:", err);
      res.status(500).json({ error: "Failed to fetch story node" });
    }
  });

  app.get("/api/ee-info/story/children/:parentId", requireAuth, async (req, res) => {
    try {
      const parentId = req.params.parentId;
      const children = await db.select().from(eeInfoNodes)
        .where(eq(eeInfoNodes.parentNodeId, parentId))
        .orderBy(eeInfoNodes.sortOrder);
      res.json(children);
    } catch (err) {
      console.error("[EE-Info] Error fetching children:", err);
      res.status(500).json({ error: "Failed to fetch children" });
    }
  });

  app.get("/api/ee-info/story/demo", requireAuth, async (_req, res) => {
    try {
      const demoNodes = await db.select().from(eeInfoNodes)
        .where(eq(eeInfoNodes.stageCode, "DEMO"))
        .orderBy(eeInfoNodes.sortOrder);
      res.json(demoNodes);
    } catch (err) {
      console.error("[EE-Info] Error fetching demo:", err);
      res.status(500).json({ error: "Failed to fetch demo walkthrough" });
    }
  });

  app.patch("/api/ee-info/story/node/:id", requireCOO, async (req, res) => {
    try {
      const nodeId = req.params.id;
      const updates = req.body;
      const allowedFields = [
        "primaryInstruction", "stageCode", "definitionOfDone",
        "ownerRoleId", "approverRoleId", "requiredLinks",
        "exampleArtifacts", "exampleNotes", "commonPitfalls",
        "nextNodeId", "title", "sortOrder", "status", "nodeType", "parentNodeId",
      ];

      const filtered: any = {};
      for (const key of allowedFields) {
        if (key in updates) filtered[key] = updates[key];
      }
      filtered.updatedAt = new Date();
      filtered.updatedBy = (req.user as any)?.email || "system";

      const [updated] = await db.update(eeInfoNodes)
        .set(filtered)
        .where(eq(eeInfoNodes.id, nodeId))
        .returning();

      if (!updated) return res.status(404).json({ error: "Node not found" });
      res.json(updated);
    } catch (err) {
      console.error("[EE-Info] Error updating story node:", err);
      res.status(500).json({ error: "Failed to update story node" });
    }
  });

  app.post("/api/ee-info/story/seed-demo", requireCOO, async (_req, res) => {
    try {
      const existing = await db.select({ id: eeInfoNodes.id }).from(eeInfoNodes)
        .where(eq(eeInfoNodes.stageCode, "DEMO"));
      if (existing.length > 0) {
        return res.json({ message: "Demo data already exists", count: existing.length });
      }
      const seeded = await seedStoryDemoData();
      res.json({ message: "Demo data seeded", count: seeded });
    } catch (err) {
      console.error("[EE-Info] Error seeding demo:", err);
      res.status(500).json({ error: "Failed to seed demo data" });
    }
  });

  app.get("/api/ee-info/story/check-seed", requireAuth, async (_req, res) => {
    try {
      const stageCount = await db.select({ id: eeInfoNodes.id }).from(eeInfoNodes)
        .where(and(
          eq(eeInfoNodes.nodeType, "lifecycle_stage"),
          sql`${eeInfoNodes.stageCode} IS NOT NULL AND ${eeInfoNodes.stageCode} NOT IN ('DEMO')`
        ));
      const demoCount = await db.select({ id: eeInfoNodes.id }).from(eeInfoNodes)
        .where(eq(eeInfoNodes.stageCode, "DEMO"));
      res.json({ hasStages: stageCount.length > 0, hasDemoData: demoCount.length > 0, stageCount: stageCount.length, demoCount: demoCount.length });
    } catch (err) {
      res.status(500).json({ error: "Failed to check seed status" });
    }
  });

  app.post("/api/ee-info/story/auto-seed", requireAuth, async (_req, res) => {
    try {
      const stageCount = await db.select({ id: eeInfoNodes.id }).from(eeInfoNodes)
        .where(and(
          eq(eeInfoNodes.nodeType, "lifecycle_stage"),
          sql`${eeInfoNodes.stageCode} IS NOT NULL AND ${eeInfoNodes.stageCode} NOT IN ('DEMO')`
        ));
      if (stageCount.length > 0) {
        return res.json({ message: "Story stages already exist", seeded: false });
      }
      const count = await seedStoryLifecycleData();
      res.json({ message: "Story lifecycle seeded", seeded: true, count });
    } catch (err) {
      console.error("[EE-Info] Error auto-seeding:", err);
      res.status(500).json({ error: "Failed to auto-seed" });
    }
  });
}

export async function seedStoryLifecycleData(): Promise<number> {
  const stages = [
    { code: "P0", title: "P0 — First Assessment", purpose: "Initial project screening and viability check. Determine if the opportunity is worth pursuing.", dod: "Site visit completed, initial capacity estimate documented, go/no-go decision recorded.", owner: "Project Developer", approver: "Head of BD", instruction: "Review the new lead and complete the First Assessment checklist." },
    { code: "P1", title: "P1 — Feasibility & Engineering Design", purpose: "Detailed technical and financial feasibility study. Produce engineering design pack and cost proposal.", dod: "Engineering design pack approved, cost proposal signed by client, financial model validated.", owner: "Engineer", approver: "Engineering Manager", instruction: "Complete the engineering design pack and prepare the cost proposal for client review." },
    { code: "P2", title: "P2 — Financial Close", purpose: "Secure funding, finalise contracts, and achieve financial close to proceed to construction.", dod: "EPC contract signed, funding agreement executed, financial close certificate issued.", owner: "Project Developer", approver: "COO", instruction: "Finalise all contracts and confirm funding is in place before construction starts." },
    { code: "P3", title: "P3 — Procurement", purpose: "Source and order all materials, equipment, and subcontractors required for construction.", dod: "All POs issued, delivery schedules confirmed, subcontractor agreements signed.", owner: "Project Manager", approver: "Procurement Manager", instruction: "Issue all purchase orders and confirm delivery schedules with suppliers." },
    { code: "P4", title: "P4 — Construction", purpose: "Execute the physical build of the solar/BESS installation on-site.", dod: "All mechanical and electrical installation complete, ready for commissioning.", owner: "Site Manager", approver: "Project Manager", instruction: "Manage daily site progress, log updates, and track completion against the plan." },
    { code: "P5", title: "P5 — Commissioning", purpose: "Test and commission the system to verify it meets design specifications and safety standards.", dod: "System energised, performance test passed, commissioning certificate issued.", owner: "Commissioning Engineer", approver: "Engineering Manager", instruction: "Run all commissioning tests and prepare the commissioning report." },
    { code: "P6", title: "P6 — Handover & Close-Out", purpose: "Hand over the completed system to operations and the client. Complete all project documentation.", dod: "O&M handover complete, client acceptance signed, final account settled, project closed.", owner: "Project Manager", approver: "COO", instruction: "Complete all handover documentation and get client sign-off." },
    { code: "P7", title: "P7 — Operations & Maintenance", purpose: "Ongoing monitoring, maintenance, and performance optimisation of the installed system.", dod: "DLP period complete, performance guarantee met, system transitioned to long-term O&M.", owner: "O&M Manager", approver: "Operations Director", instruction: "Monitor system performance and address any maintenance issues." },
  ];

  let count = 0;
  const stageIds: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const id = `story-stage-${s.code.toLowerCase()}`;
    stageIds.push(id);
    await db.insert(eeInfoNodes).values({
      id,
      slug: `story-${s.code.toLowerCase()}`,
      title: s.title,
      contentMarkdown: s.purpose,
      status: "published",
      category: "process",
      nodeType: "lifecycle_stage",
      stageCode: s.code,
      sortOrder: i * 10,
      definitionOfDone: s.dod,
      ownerRoleId: s.owner,
      approverRoleId: s.approver,
      primaryInstruction: s.instruction,
      sopData: { purpose: s.purpose, inputs: [], outputs: [] },
      nextNodeId: i < stages.length - 1 ? `story-stage-${stages[i + 1].code.toLowerCase()}` : null,
    }).onConflictDoNothing();
    count++;

    const processes = getStageProcesses(s.code, id);
    for (let j = 0; j < processes.length; j++) {
      const p = processes[j];
      await db.insert(eeInfoNodes).values({
        id: p.id,
        slug: p.slug,
        title: p.title,
        contentMarkdown: p.purpose,
        status: "published",
        category: "process",
        nodeType: "process",
        parentNodeId: id,
        stageCode: s.code,
        sortOrder: j * 10,
        definitionOfDone: p.dod,
        ownerRoleId: p.owner,
        approverRoleId: p.approver,
        primaryInstruction: p.instruction,
        sopData: { purpose: p.purpose, inputs: p.inputs || [], outputs: p.outputs || [] },
        nextNodeId: j < processes.length - 1 ? processes[j + 1].id : null,
      }).onConflictDoNothing();
      count++;
    }
  }
  return count;
}

function getStageProcesses(stageCode: string, parentId: string): any[] {
  const processData: Record<string, any[]> = {
    P0: [
      { title: "Lead Intake & Qualification", purpose: "Receive and qualify new project leads.", dod: "Lead qualified as viable or rejected with reason.", owner: "BD Associate", approver: "Head of BD", instruction: "Review the incoming lead details and determine if it meets minimum criteria.", inputs: ["Client enquiry", "Site address"], outputs: ["Qualified lead record"] },
      { title: "Site Visit & Assessment", purpose: "Visit the site to assess physical conditions and feasibility.", dod: "Site assessment report completed with photos.", owner: "Project Developer", approver: "Head of BD", instruction: "Schedule and complete the site visit, then upload the assessment report.", inputs: ["Qualified lead", "Site coordinates"], outputs: ["Site assessment report", "Photo documentation"] },
      { title: "Go / No-Go Decision", purpose: "Make the decision to proceed or abandon the opportunity.", dod: "Decision documented with rationale in the system.", owner: "Head of BD", approver: "COO", instruction: "Present the assessment to the team and record the go/no-go decision.", inputs: ["Site assessment", "Financial screening"], outputs: ["Decision record"] },
    ],
    P1: [
      { title: "Engineering Design Pack", purpose: "Produce the full engineering design for the solar/BESS system.", dod: "Design pack peer-reviewed and approved.", owner: "Design Engineer", approver: "Engineering Manager", instruction: "Create the single-line diagram, layout, and bill of materials.", inputs: ["Site assessment", "Client requirements"], outputs: ["Single-line diagram", "Layout drawing", "BoM"] },
      { title: "Cost Proposal Preparation", purpose: "Prepare the financial proposal for the client.", dod: "Cost proposal reviewed and sent to client.", owner: "Project Developer", approver: "COO", instruction: "Build the cost model and prepare the proposal document for client presentation.", inputs: ["Engineering design pack", "Supplier quotes"], outputs: ["Cost proposal document", "Financial model"] },
    ],
    P2: [
      { title: "Contract Negotiation", purpose: "Negotiate and finalise the EPC contract with the client.", dod: "EPC contract signed by both parties.", owner: "Project Developer", approver: "COO", instruction: "Finalise contract terms and get signatures from both sides.", inputs: ["Cost proposal", "Legal review"], outputs: ["Signed EPC contract"] },
      { title: "Funding Arrangement", purpose: "Secure project funding through the appropriate finance mechanism.", dod: "Funding agreement executed, funds available.", owner: "Finance Manager", approver: "CFO", instruction: "Submit funding application and follow through until approval.", inputs: ["Signed contract", "Financial model"], outputs: ["Funding agreement", "Drawdown schedule"] },
    ],
    P3: [
      { title: "Supplier Selection & PO Issue", purpose: "Select suppliers and issue purchase orders for all major equipment.", dod: "All POs issued and acknowledged by suppliers.", owner: "Procurement Officer", approver: "Procurement Manager", instruction: "Get three quotes per item, select the best, and issue the purchase order.", inputs: ["BoM", "Approved budget"], outputs: ["Purchase orders", "Delivery schedules"] },
      { title: "Subcontractor Appointment", purpose: "Appoint subcontractors for installation works.", dod: "Subcontractor agreements signed, mobilisation dates confirmed.", owner: "Project Manager", approver: "COO", instruction: "Evaluate subcontractor bids and finalise appointments.", inputs: ["Scope of work", "Budget allocation"], outputs: ["Subcontractor agreements"] },
    ],
    P4: [
      { title: "Site Mobilisation", purpose: "Mobilise resources, equipment, and materials to site.", dod: "Site compound set up, safety induction complete, materials on site.", owner: "Site Manager", approver: "Project Manager", instruction: "Set up the site compound, complete safety briefings, and confirm material deliveries.", inputs: ["Subcontractor agreements", "Delivery schedules"], outputs: ["Site readiness report"] },
      { title: "Installation & Build", purpose: "Execute the physical construction of the solar/BESS system.", dod: "All mechanical and electrical installation complete per design.", owner: "Site Manager", approver: "Project Manager", instruction: "Manage daily construction activities and log progress against the plan.", inputs: ["Engineering design pack", "Materials on site"], outputs: ["Completed installation", "Daily progress logs"] },
      { title: "Quality Inspections", purpose: "Conduct quality checks at key milestones during construction.", dod: "All quality checklists signed off, NCRs resolved.", owner: "QA Inspector", approver: "Quality Manager", instruction: "Perform inspections at each gate and log any non-conformances.", inputs: ["Quality checklist", "Design specifications"], outputs: ["Inspection reports", "NCR log"] },
    ],
    P5: [
      { title: "System Testing", purpose: "Perform electrical testing and safety checks on the completed system.", dod: "All test results within specification, safety certificates issued.", owner: "Commissioning Engineer", approver: "Engineering Manager", instruction: "Run all electrical tests per the commissioning procedure.", inputs: ["Completed installation", "Test procedures"], outputs: ["Test results", "Safety certificates"] },
      { title: "Performance Verification", purpose: "Verify system performance meets design specifications.", dod: "Performance ratio verified, generation data logged.", owner: "Commissioning Engineer", approver: "Engineering Manager", instruction: "Monitor system output and compare against design predictions.", inputs: ["Test results", "Design specifications"], outputs: ["Performance report", "Commissioning certificate"] },
    ],
    P6: [
      { title: "O&M Handover", purpose: "Transfer operational responsibility to the O&M team.", dod: "O&M team trained, documentation handed over, monitoring access granted.", owner: "Project Manager", approver: "Operations Director", instruction: "Compile handover pack and train the O&M team on the system.", inputs: ["As-built drawings", "O&M manuals"], outputs: ["Handover pack", "Training sign-off"] },
      { title: "Client Acceptance & Close-Out", purpose: "Get formal client acceptance and close out the project.", dod: "Client acceptance certificate signed, final invoice issued, project archived.", owner: "Project Manager", approver: "COO", instruction: "Present the completed project to the client and get formal sign-off.", inputs: ["Commissioning certificate", "Handover pack"], outputs: ["Client acceptance certificate", "Final account"] },
    ],
    P7: [
      { title: "Performance Monitoring", purpose: "Continuously monitor system performance and detect issues.", dod: "Monthly performance reports generated, anomalies investigated.", owner: "O&M Technician", approver: "O&M Manager", instruction: "Review daily generation data and flag any underperformance.", inputs: ["Monitoring platform access", "Performance baselines"], outputs: ["Monthly performance report"] },
      { title: "Preventive Maintenance", purpose: "Execute scheduled maintenance to keep the system in optimal condition.", dod: "Maintenance schedule completed, findings logged.", owner: "O&M Technician", approver: "O&M Manager", instruction: "Follow the maintenance schedule and log all findings.", inputs: ["Maintenance schedule", "Spare parts inventory"], outputs: ["Maintenance log", "Condition report"] },
    ],
  };

  const processes = processData[stageCode] || [];
  return processes.map((p, i) => ({
    ...p,
    id: `story-proc-${stageCode.toLowerCase()}-${i}`,
    slug: `story-proc-${stageCode.toLowerCase()}-${i}-${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`,
  }));
}

export async function seedStoryDemoData(): Promise<number> {
  const demoSteps = [
    { title: "Welcome to the Emergent Energy Lifecycle", instruction: "This demo walks you through a real solar project from first contact to operations. Click Next to begin.", notes: "You're about to follow the journey of 'Sunshine Park' — a 500kWp commercial rooftop solar installation in Johannesburg.", pitfalls: ["Don't skip stages — each builds on the last", "Every gate must be passed before proceeding"] },
    { title: "Step 1: A New Lead Arrives", instruction: "A client emails asking about solar for their warehouse. Log it as a new lead in the system.", notes: "The client is 'ABC Warehousing'. They have a 3,000m² flat concrete roof and a R2M electricity bill. This looks promising.", pitfalls: ["Always check the roof type — tiled roofs need different mounting", "Confirm the client owns the building (not leasing)"], artifacts: [{ label: "Sample Lead Form", url: "#" }] },
    { title: "Step 2: Site Visit", instruction: "Schedule a site visit and complete the assessment form with photos.", notes: "During the visit, you measure the roof, check for shading from nearby buildings, and photograph the DB board and meter room.", pitfalls: ["Take photos of EVERYTHING — you won't remember later", "Check the electrical capacity of the existing supply"], artifacts: [{ label: "Site Assessment Template", url: "#" }] },
    { title: "Step 3: Go / No-Go Decision", instruction: "Present your findings to the team. Is this project viable?", notes: "The team reviews: good roof, no shading, strong financials, willing client. Decision: GO. The project moves to P1.", pitfalls: ["Document the reasoning even for obvious 'go' decisions", "Check municipal regulations for the area"] },
    { title: "Step 4: Engineering Design", instruction: "Create the engineering design pack: single-line diagram, roof layout, and bill of materials.", notes: "The design team produces a 500kWp system using 1,000 x 500W panels, 2 x 250kW inverters, and 3 string combiner boxes.", pitfalls: ["Always check panel weight vs roof structural capacity", "Verify inverter compatibility with the grid code"], artifacts: [{ label: "Sample Single-Line Diagram", url: "#" }, { label: "Sample Roof Layout", url: "#" }] },
    { title: "Step 5: Cost Proposal", instruction: "Build the cost model and prepare the proposal for the client.", notes: "Total project cost: R4.2M. Expected payback: 4.5 years. The proposal includes a detailed breakdown and financial projections.", pitfalls: ["Don't forget to include logistics and crane hire", "Factor in permit and grid connection costs"], artifacts: [{ label: "Cost Proposal Template", url: "#" }] },
    { title: "Step 6: Contract & Financial Close", instruction: "Negotiate the EPC contract and secure funding.", notes: "After two rounds of negotiation, the client signs the EPC contract at R4.1M. Funding is secured through an asset finance agreement.", pitfalls: ["Never start work before the contract is signed", "Confirm the payment milestone schedule matches your cashflow needs"] },
    { title: "Step 7: Procurement", instruction: "Issue purchase orders for panels, inverters, mounting, and cable.", notes: "POs issued to 4 suppliers. Panels arriving in 3 weeks, inverters in 2 weeks. Cable and mounting available immediately.", pitfalls: ["Order panels early — lead times can be 6-8 weeks", "Always get written delivery confirmations"], artifacts: [{ label: "Sample Purchase Order", url: "#" }] },
    { title: "Step 8: Site Mobilisation", instruction: "Set up the site compound, complete safety inductions, and receive materials.", notes: "The site compound is established with a container office and secure storage. All workers complete HSE induction. First material delivery received.", pitfalls: ["Secure storage is critical — solar panels are a theft target", "Don't store panels on the roof before mounting is installed"] },
    { title: "Step 9: Construction Begins", instruction: "Install mounting rails, panels, DC cabling, and inverters.", notes: "Week 1-2: Mounting rails installed. Week 3: Panels mounted. Week 4: DC stringing and inverter installation. Daily progress photos taken.", pitfalls: ["Check panel orientation before tightening clamps", "Never work on the roof during rain or high wind"], artifacts: [{ label: "Daily Progress Report", url: "#" }] },
    { title: "Step 10: Quality Inspections", instruction: "Conduct quality checks at each construction gate.", notes: "QA inspections completed at 3 gates: structural, DC, and AC. One NCR raised for incorrect cable sizing — resolved within 24 hours.", pitfalls: ["Don't rush inspections to meet deadlines", "Photograph and log every NCR, no matter how minor"] },
    { title: "Step 11: Commissioning", instruction: "Run all electrical tests and energise the system.", notes: "All insulation resistance, earth continuity, and polarity tests pass. System energised at 14:32 on Thursday. First generation data appears on the monitoring platform within minutes.", pitfalls: ["Have the client's electrician present for grid connection", "Double-check protection settings before energising"], artifacts: [{ label: "Commissioning Checklist", url: "#" }] },
    { title: "Step 12: Performance Verification", instruction: "Monitor the system for 5 days and verify it meets design specifications.", notes: "The system generates 2,450 kWh on its first full day — 102% of the design prediction. Performance ratio: 82.5%. All good.", pitfalls: ["Weather-normalise your performance data", "Compare against the specific design prediction, not a generic benchmark"] },
    { title: "Step 13: O&M Handover", instruction: "Hand over the system to the O&M team with full documentation.", notes: "O&M handover pack includes: as-built drawings, O&M manuals, warranty certificates, monitoring platform access, and emergency procedures.", pitfalls: ["Train the O&M team on the specific inverter model", "Ensure monitoring alerts are configured correctly"] },
    { title: "Step 14: Client Acceptance", instruction: "Present the completed project to the client and get formal sign-off.", notes: "The client walks the site, reviews the handover documentation, and signs the acceptance certificate. Final invoice issued. Project status: COMPLETE.", pitfalls: ["Bring the commissioning certificate to the acceptance meeting", "Resolve any outstanding snag list items before requesting sign-off"], artifacts: [{ label: "Client Acceptance Template", url: "#" }] },
    { title: "Step 15: Lifecycle Complete!", instruction: "Congratulations! You've completed the full project lifecycle.", notes: "From first lead to completed installation, the Sunshine Park project took 16 weeks and generated its first kWh of clean energy. The system will produce approximately 750 MWh per year, saving the client R1.5M annually.", pitfalls: [] },
  ];

  let count = 0;
  for (let i = 0; i < demoSteps.length; i++) {
    const step = demoSteps[i];
    const id = `story-demo-${String(i).padStart(3, "0")}`;
    await db.insert(eeInfoNodes).values({
      id,
      slug: `story-demo-step-${i}`,
      title: step.title,
      contentMarkdown: step.notes || "",
      status: "published",
      category: "process",
      nodeType: "step",
      stageCode: "DEMO",
      sortOrder: i * 10,
      primaryInstruction: step.instruction,
      exampleNotes: step.notes || null,
      commonPitfalls: step.pitfalls && step.pitfalls.length > 0 ? step.pitfalls : null,
      exampleArtifacts: (step as any).artifacts || null,
      nextNodeId: i < demoSteps.length - 1 ? `story-demo-${String(i + 1).padStart(3, "0")}` : null,
    }).onConflictDoNothing();
    count++;
  }
  return count;
}
