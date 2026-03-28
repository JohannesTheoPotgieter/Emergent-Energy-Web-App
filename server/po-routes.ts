import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, sql, and } from "drizzle-orm";
import { purchaseOrders, poReviewAssignments, counterparties } from "@shared/schema";
import { logAuditFromReq } from "./audit-logger";
import { requirePermission } from "./permission-middleware";
import { jwtAuth, requireAuth, getEffectiveUser } from "./auth-context";
import { actorFromReq, createProjectEvent } from "./services/project-event-service";
import { createPoApproval } from "./services/approval-service";
import PDFDocument from "pdfkit";

// ===================== PO STATUS STATE MACHINE =====================

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["in_review", "cancelled"],
  in_review: ["requires_info", "blocked", "approved", "cancelled"],
  requires_info: ["submitted"],
  blocked: ["submitted", "cancelled"],
  approved: ["cancelled"],
  cancelled: [],
};

// Roles that can review POs
const PO_REVIEWER_ROLES = ["PROGRAM_MANAGER", "COO_ADMIN", "CEO_ADMIN"];

const EMERGENT_HEADER = {
  tel: "+27 21 828 4202 / +27 11 028 8060",
  email: "info@emergentenergy.co.za",
  cpt: "CPT - Brickfield Canvas, 35 Brickfield Road, Salt River, Cape Town",
  jhb: "JHB - 89 Bute Lane, Sandown, Sandton",
  postal: "PO Box 23877, Claremont 7735",
  vat: "4950256638",
  accountsEmail: "accounts@emergy.co.za",
};

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generatePdf(po: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 100;

    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Emergent Energy", 50, 50);
    doc.font("Helvetica").fontSize(8);
    doc.text(`Tel:        ${EMERGENT_HEADER.tel}`, 50, 65);
    doc.text(`E-mail:     ${EMERGENT_HEADER.email}`, 50, 77);
    doc.text(`Physical:   ${EMERGENT_HEADER.cpt}`, 50, 89);
    doc.text(`            ${EMERGENT_HEADER.jhb}`, 50, 101);
    doc.text(`Postal:     ${EMERGENT_HEADER.postal}`, 50, 113);
    doc.text(`VAT#:       ${EMERGENT_HEADER.vat}`, 50, 125);

    doc.moveDown(2);
    const titleY = 155;
    doc.fontSize(16).font("Helvetica-Bold");
    doc.text("Purchase Order", 50, titleY, { align: "center", width: pageWidth });

    const infoY = 185;
    doc.fontSize(9).font("Helvetica");
    doc.text(`Supplier: ${po.supplier_name}`, 50, infoY);
    doc.text(`Date:     ${po.created_date || new Date().toISOString().slice(0, 10).replace(/-/g, "/")}`, 350, infoY);
    doc.text(`VAT#:     ${po.supplier_vat || "N/A"}`, 50, infoY + 14);
    doc.text(`Project:  ${po.project_name}`, 350, infoY + 14);
    doc.text(`Address:  ${po.supplier_address || ""}`, 50, infoY + 28);
    doc.text(`PO Ref:   ${po.po_ref}`, 350, infoY + 28);
    if (po.supplier_contact) {
      doc.text(`Contact:  ${po.supplier_contact}`, 50, infoY + 42);
    }

    const tableTop = infoY + 65;
    const colWidths = [40, 180, 90, 35, 35, 80, 80];
    const colX = [50];
    for (let i = 1; i < colWidths.length; i++) {
      colX.push(colX[i - 1] + colWidths[i - 1]);
    }
    const headers = ["Item #", "Description", "Part Number", "QTY", "Unit", "Price per Unit", "Sub-Total"];

    doc.font("Helvetica-Bold").fontSize(8);
    doc.rect(50, tableTop - 5, pageWidth, 18).fill("#f0f0f0").stroke("#cccccc");
    doc.fillColor("#000000");
    headers.forEach((h, i) => {
      doc.text(h, colX[i] + 2, tableTop, { width: colWidths[i] - 4, align: i >= 3 ? "right" : "left" });
    });

    doc.font("Helvetica").fontSize(8);
    let rowY = tableTop + 22;
    const lineItems = (Array.isArray(po.line_items) ? po.line_items : []) as Record<string, unknown>[];
    lineItems.forEach((item: Record<string, unknown>, idx: number) => {
      if (rowY > 700) {
        doc.addPage();
        rowY = 50;
      }
      const qty = Number(item.qty) || 0;
      const price = Number(item.pricePerUnit) || 0;
      const lineSubtotal = qty * price;
      doc.text(String(idx + 1), colX[0] + 2, rowY, { width: colWidths[0] - 4 });
      doc.text(String(item.description || ""), colX[1] + 2, rowY, { width: colWidths[1] - 4 });
      doc.text(String(item.partNumber || ""), colX[2] + 2, rowY, { width: colWidths[2] - 4 });
      doc.text(String(qty), colX[3] + 2, rowY, { width: colWidths[3] - 4, align: "right" });
      doc.text(String(item.unit || ""), colX[4] + 2, rowY, { width: colWidths[4] - 4, align: "right" });
      doc.text(`R ${formatCurrency(price)}`, colX[5] + 2, rowY, { width: colWidths[5] - 4, align: "right" });
      doc.text(`R ${formatCurrency(lineSubtotal)}`, colX[6] + 2, rowY, { width: colWidths[6] - 4, align: "right" });
      rowY += Math.max(20, doc.heightOfString(String(item.description || ""), { width: colWidths[1] - 4 }) + 8);
    });

    rowY += 10;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text(`Sub-Total: R ${formatCurrency(Number(po.subtotal) || 0)}`, 350, rowY, { width: 190, align: "right" });
    rowY += 14;
    doc.text(`VAT: R ${formatCurrency(Number(po.vat_amount) || 0)}`, 350, rowY, { width: 190, align: "right" });
    rowY += 14;
    doc.text(`Total: R ${formatCurrency(Number(po.total) || 0)}`, 350, rowY, { width: 190, align: "right" });

    rowY += 30;
    doc.font("Helvetica").fontSize(8);

    const sectionRow = (label: string, value: string) => {
      if (rowY > 740) { doc.addPage(); rowY = 50; }
      doc.font("Helvetica-Bold").text(label, 50, rowY, { width: 120 });
      doc.font("Helvetica").text(value, 170, rowY, { width: 370 });
      rowY += Math.max(16, doc.heightOfString(value, { width: 370 }) + 8);
    };

    sectionRow("Payment Terms", String(po.payment_terms || `All invoicing is to be sent to ${EMERGENT_HEADER.accountsEmail}`));
    sectionRow("Delivery Instructions", [
      po.delivery_date ? `Delivery date: ${po.delivery_date}` : "",
      po.delivery_address ? `Delivery address: ${po.delivery_address}` : "",
      po.site_contact ? `Site Contact: ${po.site_contact}` : "",
    ].filter(Boolean).join("\n"));
    if (po.comments) sectionRow("Comments", String(po.comments));

    rowY += 20;
    if (po.project_manager) {
      doc.font("Helvetica-Bold").text("Project Manager:", 50, rowY, { width: 120 });
      doc.font("Helvetica").text(String(po.project_manager), 170, rowY);
      doc.text(String(po.created_date || new Date().toISOString().slice(0, 10).replace(/-/g, "/")), 400, rowY);
    }

    doc.end();
  });
}

function makeProjectCode(projectName: string): string {
  const words = projectName.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 4).toUpperCase();
  return words.map(w => w[0]).join("").substring(0, 4).toUpperCase();
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

export function registerPoRoutes(app: Express) {

  // ===================== LIST POs =====================
  // Supports both project-scoped and board-wide listing

  app.get("/api/po/:projectName", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectName } = req.params;
      const rows = await db.execute(sql`
        SELECT po.id, po.po_ref, po.po_number, po.project_name, po.project_id,
               po.supplier_name, po.supplier_vat, po.supplier_address, po.supplier_contact,
               po.line_items, po.subtotal, po.vat_amount, po.total,
               po.payment_terms, po.delivery_date, po.delivery_address, po.site_contact,
               po.comments, po.project_manager, po.status, po.created_by,
               po.created_at, po.updated_at, po.sent_at,
               po.counterparty_id, po.approval_id, po.submitted_at, po.approved_at,
               c.name_canonical as counterparty_name
        FROM purchase_orders po
        LEFT JOIN counterparties c ON po.counterparty_id = c.id
        WHERE po.project_name = ${projectName}
        ORDER BY po.created_at DESC
      `);
      res.json(rows.rows || []);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error("[PO] List error:", errMessage);
      res.status(500).json({ error: "Failed to list POs" });
    }
  });

  // ===================== PO APPROVAL BOARD =====================
  // All POs grouped by status with reviewer info

  app.get("/api/po/board/all", jwtAuth, requireAuth, requirePermission("procurement", "view"), async (req: Request, res: Response) => {
    try {
      const rows = await db.execute(sql`
        SELECT po.id, po.po_ref, po.po_number, po.project_name, po.project_id,
               po.supplier_name, po.total, po.status, po.created_at, po.submitted_at, po.approved_at,
               po.counterparty_id, po.project_manager,
               c.name_canonical as counterparty_name,
               u.name as submitted_by_name,
               (
                 SELECT json_agg(json_build_object(
                   'id', pra.id,
                   'reviewerUserId', pra.reviewer_user_id,
                   'reviewerRole', pra.reviewer_role,
                   'decision', pra.decision,
                   'decidedAt', pra.decided_at,
                   'reviewerName', ru.name
                 ))
                 FROM po_review_assignments pra
                 LEFT JOIN users ru ON pra.reviewer_user_id = ru.id
                 WHERE pra.purchase_order_id = po.id
               ) as reviewers
        FROM purchase_orders po
        LEFT JOIN counterparties c ON po.counterparty_id = c.id
        LEFT JOIN users u ON po.submitted_by_user_id = u.id
        ORDER BY po.created_at DESC
      `);
      res.json(rowsFromResult(rows));
    } catch (err: unknown) {
      console.error("[PO] Board error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to load PO board" });
    }
  });

  // ===================== MY PO REVIEWS =====================

  app.get("/api/po/board/my-reviews", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const rows = await db.execute(sql`
        SELECT po.id, po.po_ref, po.po_number, po.project_name, po.project_id,
               po.supplier_name, po.total, po.status, po.created_at, po.submitted_at,
               po.project_manager,
               pra.decision as my_decision, pra.id as review_assignment_id,
               c.name_canonical as counterparty_name
        FROM po_review_assignments pra
        JOIN purchase_orders po ON pra.purchase_order_id = po.id
        LEFT JOIN counterparties c ON po.counterparty_id = c.id
        WHERE pra.reviewer_user_id = ${user.id}
          AND pra.decision = 'pending'
          AND po.status IN ('submitted', 'in_review')
        ORDER BY po.created_at ASC
      `);
      res.json(rowsFromResult(rows));
    } catch (err: unknown) {
      console.error("[PO] My reviews error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to load my PO reviews" });
    }
  });

  // ===================== CREATE PO =====================
  // Refactored: now accepts counterpartyId and projectId

  app.post("/api/po/generate", jwtAuth, requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      const {
        projectName, projectId, counterpartyId,
        supplierName, supplierVat, supplierAddress, supplierContact,
        lineItems, paymentTerms, deliveryDate, deliveryAddress, siteContact,
        comments, projectManager
      } = req.body;

      if (!projectName || !supplierName || !lineItems?.length) {
        return res.status(400).json({ error: "projectName, supplierName, and at least one line item required" });
      }

      const seqResult = await db.execute(sql.raw(`SELECT nextval('po_number_seq') as num`));
      const poNumber = parseInt(seqResult.rows[0]?.num as string);

      const projectCode = makeProjectCode(projectName);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const supplierCode = supplierName.replace(/[^a-zA-Z]/g, "").substring(0, 10);
      const poRef = `PO${poNumber}-${projectCode}-${dateStr}-${supplierCode}`;

      let subtotal = 0;
      const parsedItems = lineItems.map((item: Record<string, unknown>) => {
        const qty = parseFloat(String(item.qty)) || 0;
        const price = parseFloat(String(item.pricePerUnit)) || 0;
        subtotal += qty * price;
        return { ...item, qty, pricePerUnit: price };
      });
      const vatAmountCalc = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vatAmountCalc) * 100) / 100;

      const defaultPaymentTerms = `All invoicing is to be sent to ${EMERGENT_HEADER.accountsEmail}`;
      const pmName = projectManager || user?.name;

      const poData = {
        po_ref: poRef,
        po_number: poNumber,
        project_name: projectName,
        supplier_name: supplierName,
        supplier_vat: supplierVat || null,
        supplier_address: supplierAddress || null,
        supplier_contact: supplierContact || null,
        line_items: parsedItems,
        subtotal,
        vat_amount: vatAmountCalc,
        total,
        payment_terms: paymentTerms || defaultPaymentTerms,
        delivery_date: deliveryDate || null,
        delivery_address: deliveryAddress || null,
        site_contact: siteContact || null,
        comments: comments || null,
        project_manager: pmName,
        created_date: new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
      };

      const pdfBuffer = await generatePdf(poData);

      const insertResult = await db.execute(sql`
        INSERT INTO purchase_orders (
          po_ref, po_number, project_name, project_id, supplier_name, supplier_vat,
          supplier_address, supplier_contact, line_items, subtotal, vat_amount,
          total, payment_terms, delivery_date, delivery_address, site_contact,
          comments, project_manager, status, created_by, pdf_data, counterparty_id
        ) VALUES (
          ${poRef}, ${poNumber}, ${projectName}, ${projectId || null},
          ${supplierName}, ${supplierVat || null},
          ${supplierAddress || null},
          ${supplierContact || null},
          ${JSON.stringify(parsedItems)}::jsonb,
          ${subtotal}, ${vatAmountCalc}, ${total},
          ${paymentTerms || defaultPaymentTerms},
          ${deliveryDate || null},
          ${deliveryAddress || null},
          ${siteContact || null},
          ${comments || null},
          ${pmName},
          'draft', ${user?.id},
          ${pdfBuffer},
          ${counterpartyId || null}
        ) RETURNING id
      `);

      const poId = insertResult.rows[0]?.id;

      logAuditFromReq(req, {
        entityType: "purchase_order",
        entityId: String(poId),
        action: "create",
        changesJson: { poRef, projectName, supplierName, total },
      });

      res.json({
        id: poId,
        poRef,
        poNumber,
        subtotal,
        vatAmount: vatAmountCalc,
        total,
        pdfBase64: pdfBuffer.toString("base64"),
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error("[PO] Generate error:", errMessage);
      res.status(500).json({ error: "Failed to generate PO" });
    }
  });

  // ===================== SUBMIT PO FOR APPROVAL =====================

  app.post("/api/po/:poId/submit", jwtAuth, requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const poIdNum = parseInt(String(req.params.poId));
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      // Get current PO
      const poResult = await db.execute(sql`SELECT * FROM purchase_orders WHERE id = ${poIdNum}`);
      const po = rowsFromResult(poResult)[0];
      if (!po) return res.status(404).json({ error: "PO not found" });

      // Validate state transition
      const currentStatus = String(po.status);
      if (!VALID_TRANSITIONS[currentStatus]?.includes("submitted")) {
        return res.status(400).json({ error: `Cannot submit PO from status '${currentStatus}'` });
      }

      const projectId = Number(po.project_id) || 0;
      const total = Number(po.total) || 0;

      // Create approval
      const approval = await createPoApproval({
        projectId,
        purchaseOrderId: poIdNum,
        requestedByUserId: user.id,
        title: `PO ${po.po_ref} — ${po.supplier_name} — R${formatCurrency(total)}`,
        total,
      });

      // Create reviewer assignments — find users with PO_REVIEWER_ROLES
      const reviewerRows = await db.execute(sql`
        SELECT id, name, role FROM users
        WHERE role = ANY(${PO_REVIEWER_ROLES})
          AND is_active = true
        LIMIT 10
      `);
      const reviewers = rowsFromResult(reviewerRows);

      for (const reviewer of reviewers) {
        await db.execute(sql`
          INSERT INTO po_review_assignments (purchase_order_id, reviewer_user_id, reviewer_role, decision)
          VALUES (${poIdNum}, ${Number(reviewer.id)}, ${String(reviewer.role)}, 'pending')
        `);
      }

      // Update PO status
      await db.execute(sql`
        UPDATE purchase_orders
        SET status = 'submitted', approval_id = ${approval.id},
            submitted_by_user_id = ${user.id}, submitted_at = NOW(), updated_at = NOW()
        WHERE id = ${poIdNum}
      `);

      logAuditFromReq(req, {
        entityType: "purchase_order",
        entityId: String(poIdNum),
        action: "submit_for_approval",
        changesJson: { approvalId: approval.id, reviewerCount: reviewers.length },
      });

      if (projectId) {
        const actor = actorFromReq(req);
        createProjectEvent({
          projectId,
          eventType: "project.po_submitted",
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "purchase_order",
          sourceEntityId: String(poIdNum),
          summary: `PO ${po.po_ref} submitted for approval`,
          details: { poId: poIdNum, poRef: po.po_ref, total },
        });
      }

      res.json({ success: true, approvalId: approval.id, reviewerCount: reviewers.length });
    } catch (err: unknown) {
      console.error("[PO] Submit error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to submit PO for approval" });
    }
  });

  // ===================== REVIEW PO =====================

  app.post("/api/po/:poId/review", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getEffectiveUser(req);
      if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

      const poIdNum = parseInt(String(req.params.poId));
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      const { decision, notes } = req.body;
      const validDecisions = ["approved", "requires_info", "blocked"];
      if (!validDecisions.includes(decision)) {
        return res.status(400).json({ error: `Invalid decision. Must be: ${validDecisions.join(", ")}` });
      }

      // Find the reviewer's assignment
      const assignmentResult = await db.execute(sql`
        SELECT id FROM po_review_assignments
        WHERE purchase_order_id = ${poIdNum} AND reviewer_user_id = ${user.id} AND decision = 'pending'
      `);
      const assignment = rowsFromResult(assignmentResult)[0];
      if (!assignment) {
        return res.status(403).json({ error: "You are not a pending reviewer for this PO" });
      }

      // Record decision
      await db.execute(sql`
        UPDATE po_review_assignments
        SET decision = ${decision}, decided_at = NOW(), notes = ${notes || null}, updated_at = NOW()
        WHERE id = ${Number(assignment.id)}
      `);

      // Check all reviewer decisions to determine PO status
      const allReviewsResult = await db.execute(sql`
        SELECT decision FROM po_review_assignments WHERE purchase_order_id = ${poIdNum}
      `);
      const allReviews = rowsFromResult(allReviewsResult);

      let newPoStatus = "in_review";
      const decisions = allReviews.map(r => String(r.decision));

      if (decisions.some(d => d === "blocked")) {
        newPoStatus = "blocked";
      } else if (decisions.some(d => d === "requires_info")) {
        newPoStatus = "requires_info";
      } else if (decisions.every(d => d === "approved")) {
        newPoStatus = "approved";
      }

      const updateFields: string[] = [`status = '${newPoStatus}'`, `updated_at = NOW()`];
      if (newPoStatus === "approved") {
        updateFields.push(`approved_at = NOW()`);
      }

      await db.execute(sql.raw(`
        UPDATE purchase_orders SET ${updateFields.join(", ")} WHERE id = ${poIdNum}
      `));

      logAuditFromReq(req, {
        entityType: "purchase_order",
        entityId: String(poIdNum),
        action: "review",
        changesJson: { decision, reviewerUserId: user.id, resultingStatus: newPoStatus },
      });

      // Get project ID for event
      const poResult = await db.execute(sql`SELECT project_id, po_ref FROM purchase_orders WHERE id = ${poIdNum}`);
      const po = rowsFromResult(poResult)[0];
      if (po?.project_id) {
        const actor = actorFromReq(req);
        createProjectEvent({
          projectId: Number(po.project_id),
          eventType: newPoStatus === "approved" ? "project.po_approved" : "project.po_reviewed",
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: "purchase_order",
          sourceEntityId: String(poIdNum),
          summary: `PO ${po.po_ref} ${newPoStatus}`,
          details: { poId: poIdNum, poRef: po.po_ref, decision, newStatus: newPoStatus },
        });
      }

      res.json({ success: true, newStatus: newPoStatus, decision });
    } catch (err: unknown) {
      console.error("[PO] Review error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to review PO" });
    }
  });

  // ===================== UPDATE PO STATUS (with state machine) =====================

  app.patch("/api/po/:poId/status", jwtAuth, requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
    try {
      const poIdNum = parseInt(String(req.params.poId));
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      const { status } = req.body;

      // Get current status
      const poResult = await db.execute(sql`SELECT status FROM purchase_orders WHERE id = ${poIdNum}`);
      const po = rowsFromResult(poResult)[0];
      if (!po) return res.status(404).json({ error: "PO not found" });

      const currentStatus = String(po.status);
      const allowed = VALID_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Invalid transition from '${currentStatus}' to '${status}'. Allowed: ${allowed.join(", ") || "none"}`,
        });
      }

      if (status === "sent") {
        // Legacy compat: map 'sent' to 'submitted'
        await db.execute(sql`
          UPDATE purchase_orders SET status = 'submitted', updated_at = NOW(), sent_at = NOW()
          WHERE id = ${poIdNum}
        `);
      } else {
        await db.execute(sql`
          UPDATE purchase_orders SET status = ${status}, updated_at = NOW()
          WHERE id = ${poIdNum}
        `);
      }

      logAuditFromReq(req, {
        entityType: "purchase_order",
        entityId: String(poIdNum),
        action: "update_status",
        changesJson: { from: currentStatus, to: status },
      });

      res.json({ success: true });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error("[PO] Status update error:", errMessage);
      res.status(500).json({ error: "Failed to update PO status" });
    }
  });

  // ===================== PO PDF DOWNLOAD =====================

  app.get("/api/po/:projectName/:poId/pdf", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const poIdNum = parseInt(String(req.params.poId));
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      const result = await db.execute(sql`
        SELECT pdf_data, po_ref FROM purchase_orders WHERE id = ${poIdNum}
      `);
      const row = result.rows[0];
      if (!row?.pdf_data) return res.status(404).json({ error: "PO not found" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${row.po_ref}.pdf"`);
      res.send(row.pdf_data);
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error("[PO] PDF download error:", errMessage);
      res.status(500).json({ error: "Failed to download PO PDF" });
    }
  });

  // ===================== DELETE PO (draft only) =====================

  app.delete("/api/po/:poId", jwtAuth, requireAuth, requirePermission('procurement', 'delete'), async (req: Request, res: Response) => {
    try {
      const poIdNum = parseInt(String(req.params.poId));
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      await db.execute(sql`DELETE FROM purchase_orders WHERE id = ${poIdNum} AND status = 'draft'`);

      logAuditFromReq(req, {
        entityType: "purchase_order",
        entityId: String(poIdNum),
        action: "delete",
        changesJson: {},
      });

      res.json({ success: true });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error("[PO] Delete error:", errMessage);
      res.status(500).json({ error: "Failed to delete PO" });
    }
  });

  // ===================== GET SINGLE PO WITH REVIEWS =====================

  app.get("/api/po/detail/:poId", jwtAuth, requireAuth, async (req: Request, res: Response) => {
    try {
      const poIdNum = parseInt(String(req.params.poId));
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      const poResult = await db.execute(sql`
        SELECT po.*, c.name_canonical as counterparty_name, u.name as submitted_by_name
        FROM purchase_orders po
        LEFT JOIN counterparties c ON po.counterparty_id = c.id
        LEFT JOIN users u ON po.submitted_by_user_id = u.id
        WHERE po.id = ${poIdNum}
      `);
      const po = rowsFromResult(poResult)[0];
      if (!po) return res.status(404).json({ error: "PO not found" });

      const reviewsResult = await db.execute(sql`
        SELECT pra.*, u.name as reviewer_name
        FROM po_review_assignments pra
        LEFT JOIN users u ON pra.reviewer_user_id = u.id
        WHERE pra.purchase_order_id = ${poIdNum}
        ORDER BY pra.created_at ASC
      `);

      res.json({ ...po, reviews: rowsFromResult(reviewsResult) });
    } catch (err: unknown) {
      console.error("[PO] Detail error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Failed to load PO detail" });
    }
  });
}
