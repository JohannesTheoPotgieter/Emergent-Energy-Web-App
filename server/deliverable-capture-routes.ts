import { type Express, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "./db";
import { sql, eq, and, isNull, asc } from "drizzle-orm";
import { deliverables, projectInfo, normalizedCostLines, normalizedRevenueLines, workItems } from "@shared/schema";
import { logAuditFromReq } from "./audit-logger";
import { getEffectiveUser, jwtAuth, requireAuth } from "./auth-context";
import { requirePermission } from "./permission-middleware";
import { getAssignmentsForEntity, setEntityAssignment } from "./services/assignment-service";

const uploadDir = path.join(process.cwd(), "uploads", "_private_deliverables");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const deliverableUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9_.\-]/g, "_");
      cb(null, `${ts}_${sanitized}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function getUser(req: Request): any {
  return getEffectiveUser(req);
}


export function registerDeliverableCaptureRoutes(app: Express) {
  app.get("/api/deliverable-capture/linkable-items/:projectId", jwtAuth, requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const [taskRows, costRows, revenueRows] = await Promise.all([
        db.select({
          id: workItems.id,
          title: workItems.title,
          status: workItems.status,
          workstream: workItems.workstream,
          type: workItems.type,
          phase: workItems.phase,
          wbsCode: workItems.wbsCode,
        })
          .from(workItems)
          .where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt)))
          .orderBy(asc(workItems.id))
          .limit(500),
        db.select({
          id: normalizedCostLines.id,
          description: normalizedCostLines.description,
          counterpartyName: normalizedCostLines.counterpartyName,
          costCategory: normalizedCostLines.costCategory,
          amountExVat: normalizedCostLines.amountExVat,
          invoiceNumber: normalizedCostLines.invoiceNumber,
          status: normalizedCostLines.status,
          poNumber: normalizedCostLines.poNumber,
        })
          .from(normalizedCostLines)
          .where(eq(normalizedCostLines.projectId, projectId))
          .orderBy(asc(normalizedCostLines.id))
          .limit(500),
        db.select({
          id: normalizedRevenueLines.id,
          milestoneName: normalizedRevenueLines.milestoneName,
          description: normalizedRevenueLines.description,
          amountExVat: normalizedRevenueLines.amountExVat,
          invoiceNumber: normalizedRevenueLines.invoiceNumber,
          status: normalizedRevenueLines.status,
        })
          .from(normalizedRevenueLines)
          .where(eq(normalizedRevenueLines.projectId, projectId))
          .orderBy(asc(normalizedRevenueLines.id))
          .limit(500),
      ]);

      res.json({
        workItems: taskRows,
        costLines: costRows,
        revenueLines: revenueRows,
      });
    } catch (err: any) {
      console.error("[Deliverable Capture] Linkable items error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/deliverable-capture/projects", jwtAuth, requireAuth, async (_req, res) => {
    try {
      const projects = await db.select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
      })
        .from(projectInfo)
        .orderBy(asc(projectInfo.projectName));
      res.json(projects);
    } catch (err: any) {
      console.error("[Deliverable Capture] Projects error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/deliverable-capture/upload", jwtAuth, requireAuth, requirePermission("deliverables", "create"), deliverableUpload.single("file"), async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const file = req.file;
      const {
        projectId,
        projectName,
        title,
        linkType,
        linkId,
        deliverableType,
        description,
        ownerUserId: legacyOwnerUserId,
        ownerAssigneeType,
        ownerAssigneeId,
      } = req.body;

      if (!file) {
        return res.status(400).json({ error: "A file is required" });
      }
      if (!projectId || !title) {
        return res.status(400).json({ error: "projectId and title are required" });
      }

      const pId = parseInt(projectId);
      const lId = linkId ? parseInt(linkId) : null;

      const linkedWorkItemId = linkType === "work_item" ? lId : null;
      const linkedCostLineId = linkType === "cost_line" ? lId : null;
      const linkedRevenueLineId = linkType === "revenue_line" ? lId : null;
      const ownerAssignmentType = ownerAssigneeType || (legacyOwnerUserId ? "internal_user" : "internal_user");
      const ownerAssignmentId = ownerAssigneeId ? parseInt(String(ownerAssigneeId), 10) : legacyOwnerUserId ? parseInt(String(legacyOwnerUserId), 10) : user.id;

      const [deliv] = await db.insert(deliverables).values({
        projectId: pId,
        projectName: projectName || "",
        title,
        deliverableType: deliverableType || "document",
        description: description || null,
        ownerUserId: ownerAssignmentType === "internal_user" ? ownerAssignmentId : null,
        status: "UPLOADED",
      }).returning();

      const assignments = await setEntityAssignment(req, {
        entityType: "deliverable",
        entityId: deliv.id,
        assignmentRole: "OWNER",
        assigneeType: ownerAssignmentType,
        assigneeId: ownerAssignmentId,
        mode: "replace",
      });

      await db.execute(sql`
        UPDATE deliverables
        SET linked_work_item_id = ${linkedWorkItemId},
            linked_cost_line_id = ${linkedCostLineId},
            linked_revenue_line_id = ${linkedRevenueLineId},
            file_path = ${file ? file.path : null},
            file_size = ${file ? file.size : null},
            mime_type = ${file ? file.mimetype : null},
            original_file_name = ${file ? file.originalname : null}
        WHERE id = ${deliv.id}
      `);

      if (file && lId) {
        const fileNameWithoutExt = path.parse(file.originalname).name;
        if (linkType === "cost_line") {
          await db.update(normalizedCostLines)
            .set({ invoiceNumber: fileNameWithoutExt })
            .where(eq(normalizedCostLines.id, lId));
        } else if (linkType === "revenue_line") {
          await db.update(normalizedRevenueLines)
            .set({ invoiceNumber: fileNameWithoutExt })
            .where(eq(normalizedRevenueLines.id, lId));
        }
      }

      logAuditFromReq(req, {
        entityType: "deliverable",
        entityId: String(deliv.id),
        action: "create",
        changesJson: {
          description: `Deliverable captured: ${title}`,
          linkType,
          linkId: lId,
          fileName: file?.originalname,
          ownerAssignmentType,
          ownerAssignmentId,
          invoiceNumberSet: file && (linkType === "cost_line" || linkType === "revenue_line") ? path.parse(file.originalname).name : null,
        },
      });

      res.json({
        ...deliv,
        assignments,
        primaryAssignment: assignments.find((assignment) => assignment.assignmentRole === "OWNER") || assignments[0] || null,
        linkedWorkItemId,
        linkedCostLineId,
        linkedRevenueLineId,
        fileName: file?.originalname,
      });
    } catch (err: any) {
      console.error("[Deliverable Capture] Upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/deliverable-capture/list/:projectId", jwtAuth, requireAuth, async (req, res) => {
    try {
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

      const rows = await db.execute(sql`
        SELECT d.id, d.title, d.deliverable_type, d.description, d.status, d.created_at,
               d.linked_work_item_id, d.linked_cost_line_id, d.linked_revenue_line_id,
               d.file_path, d.file_size, d.mime_type, d.original_file_name,
               u.name as owner_name,
               wi.title as linked_work_item_title,
               cl.description as linked_cost_description,
               cl.counterparty_name as linked_cost_counterparty,
               rl.milestone_name as linked_revenue_milestone
        FROM deliverables d
        LEFT JOIN users u ON u.id = d.owner_user_id
        LEFT JOIN work_items wi ON wi.id = d.linked_work_item_id
        LEFT JOIN normalized_cost_lines cl ON cl.id = d.linked_cost_line_id
        LEFT JOIN normalized_revenue_lines rl ON rl.id = d.linked_revenue_line_id
        WHERE d.project_id = ${projectId}
          AND d.file_path IS NOT NULL
        ORDER BY d.created_at DESC
      `);

      const serializedRows = (rows.rows || []) as any[];
      const assignmentEntries = await Promise.all(
        serializedRows.map(async (row) => [Number(row.id), await getAssignmentsForEntity("deliverable", Number(row.id))] as const),
      );
      const assignmentMap = new Map(assignmentEntries);

      res.json(serializedRows.map((row) => ({
        ...row,
        assignments: assignmentMap.get(Number(row.id)) || [],
        primaryAssignment: (assignmentMap.get(Number(row.id)) || [])[0] || null,
      })));
    } catch (err: any) {
      console.error("[Deliverable Capture] List error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/deliverable-capture/download/:id", jwtAuth, requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const rows = await db.execute(sql`
        SELECT file_path, original_file_name, mime_type
        FROM deliverables WHERE id = ${id}
      `);
      const row = (rows.rows || [])[0] as any;
      if (!row?.file_path) return res.status(404).json({ error: "File not found" });

      if (!fs.existsSync(row.file_path)) return res.status(404).json({ error: "File not found on disk" });

      res.setHeader("Content-Disposition", `attachment; filename="${row.original_file_name || "file"}"`);
      res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
      fs.createReadStream(row.file_path).pipe(res);
    } catch (err: any) {
      console.error("[Deliverable Capture] Download error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
