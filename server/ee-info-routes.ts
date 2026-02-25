import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eeInfoNodes, eeInfoEdges, eeInfoAssets, eeInfoVersions, eeInfoSettings } from "@shared/schema";
import { eq, sql, ilike, and, or, inArray } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import multer from "multer";

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
  return res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireCOO(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ error: "auth_required" });
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

  const processPatterns = [/\(p[dma]+\d*\)/i, /\(epm?\d*\)/i, /\(cpm\d*\)/i, /\(pdpm\d*\)/i, /process/i, /planning/i, /construction/i, /hand over/i, /commissioning/i, /close out/i, /engagement/i, /assessment/i, /procurement/i, /invoic/i, /payment/i, /inventory/i, /compliance/i, /hse/i, /red team/i, /research/i, /relationship/i, /deal/i, /tender/i, /site visit/i, /meter/i, /data tool/i, /engineering design/i, /engineering pack/i, /cost proposal/i, /final offer/i, /sseg/i];
  if (processPatterns.some(p => p.test(t))) return "process";

  const toolKeywords = ["click up", "sharepoint", "ms teams", "matriarch"];
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
  const AdmZip = require("adm-zip");
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
      const { title, contentMarkdown, category, tags, flowEnabled, flowLane, flowStepCode, nextSlugs, prevSlugs } = req.body;
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
      const { title, contentMarkdown, category, tags, status, flowEnabled, flowLane, flowStepCode, nextSlugs, prevSlugs } = req.body;

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
}
