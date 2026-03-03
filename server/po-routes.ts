import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { logAuditFromReq } from "./audit-logger";
import PDFDocument from "pdfkit";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: "Invalid token" });
  (req as any).user = user;
  next();
}

const EMERGENT_HEADER = {
  tel: "+27 21 828 4202 / +27 11 028 8060",
  email: "info@emergentenergy.co.za",
  cpt: "CPT - Brickfield Canvas, 35 Brickfield Road, Salt River, Cape Town",
  jhb: "JHB - 89 Bute Lane, Sandown, Sandton",
  postal: "PO Box 23877, Claremont 7735",
  vat: "4950256638",
  accountsEmail: "accounts@emergy.co.za",
};

async function ensurePoTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      po_ref TEXT NOT NULL UNIQUE,
      po_number INTEGER NOT NULL,
      project_name TEXT NOT NULL,
      project_id INTEGER REFERENCES project_info(id),
      supplier_name TEXT NOT NULL,
      supplier_vat TEXT,
      supplier_address TEXT,
      supplier_contact TEXT,
      line_items JSONB NOT NULL DEFAULT '[]',
      subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
      vat_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      total DECIMAL(15,2) NOT NULL DEFAULT 0,
      payment_terms TEXT,
      delivery_date TEXT,
      delivery_address TEXT,
      site_contact TEXT,
      comments TEXT,
      project_manager TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMP,
      pdf_data BYTEA
    );
    CREATE INDEX IF NOT EXISTS idx_po_project ON purchase_orders(project_name);
    CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
  `));

  await db.execute(sql.raw(`
    CREATE SEQUENCE IF NOT EXISTS po_number_seq START WITH 3800;
  `));
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generatePdf(po: any): Promise<Buffer> {
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
    const lineItems = po.line_items || [];
    lineItems.forEach((item: any, idx: number) => {
      if (rowY > 700) {
        doc.addPage();
        rowY = 50;
      }
      const lineSubtotal = (item.qty || 0) * (item.pricePerUnit || 0);
      doc.text(String(idx + 1), colX[0] + 2, rowY, { width: colWidths[0] - 4 });
      doc.text(item.description || "", colX[1] + 2, rowY, { width: colWidths[1] - 4 });
      doc.text(item.partNumber || "", colX[2] + 2, rowY, { width: colWidths[2] - 4 });
      doc.text(String(item.qty || 0), colX[3] + 2, rowY, { width: colWidths[3] - 4, align: "right" });
      doc.text(item.unit || "", colX[4] + 2, rowY, { width: colWidths[4] - 4, align: "right" });
      doc.text(`R ${formatCurrency(item.pricePerUnit || 0)}`, colX[5] + 2, rowY, { width: colWidths[5] - 4, align: "right" });
      doc.text(`R ${formatCurrency(lineSubtotal)}`, colX[6] + 2, rowY, { width: colWidths[6] - 4, align: "right" });
      rowY += Math.max(20, doc.heightOfString(item.description || "", { width: colWidths[1] - 4 }) + 8);
    });

    rowY += 10;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text(`Sub-Total: R ${formatCurrency(po.subtotal || 0)}`, 350, rowY, { width: 190, align: "right" });
    rowY += 14;
    doc.text(`VAT: R ${formatCurrency(po.vat_amount || 0)}`, 350, rowY, { width: 190, align: "right" });
    rowY += 14;
    doc.text(`Total: R ${formatCurrency(po.total || 0)}`, 350, rowY, { width: 190, align: "right" });

    rowY += 30;
    doc.font("Helvetica").fontSize(8);

    const sectionRow = (label: string, value: string) => {
      if (rowY > 740) { doc.addPage(); rowY = 50; }
      doc.font("Helvetica-Bold").text(label, 50, rowY, { width: 120 });
      doc.font("Helvetica").text(value, 170, rowY, { width: 370 });
      rowY += Math.max(16, doc.heightOfString(value, { width: 370 }) + 8);
    };

    sectionRow("Payment Terms", po.payment_terms || `All invoicing is to be sent to ${EMERGENT_HEADER.accountsEmail}`);
    sectionRow("Delivery Instructions", [
      po.delivery_date ? `Delivery date: ${po.delivery_date}` : "",
      po.delivery_address ? `Delivery address: ${po.delivery_address}` : "",
      po.site_contact ? `Site Contact: ${po.site_contact}` : "",
    ].filter(Boolean).join("\n"));
    if (po.comments) sectionRow("Comments", po.comments);

    rowY += 20;
    if (po.project_manager) {
      doc.font("Helvetica-Bold").text("Project Manager:", 50, rowY, { width: 120 });
      doc.font("Helvetica").text(po.project_manager, 170, rowY);
      doc.text(po.created_date || new Date().toISOString().slice(0, 10).replace(/-/g, "/"), 400, rowY);
    }

    doc.end();
  });
}

function makeProjectCode(projectName: string): string {
  const words = projectName.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 4).toUpperCase();
  return words.map(w => w[0]).join("").substring(0, 4).toUpperCase();
}

export function registerPoRoutes(app: Express) {
  app.get("/api/po/:projectName", requireAuth, async (req, res) => {
    try {
      const { projectName } = req.params;
      const rows = await db.execute(sql`
        SELECT id, po_ref, po_number, project_name, supplier_name, supplier_vat,
               supplier_address, supplier_contact, line_items, subtotal, vat_amount,
               total, payment_terms, delivery_date, delivery_address, site_contact,
               comments, project_manager, status, created_by, created_at, updated_at, sent_at
        FROM purchase_orders
        WHERE project_name = ${projectName}
        ORDER BY created_at DESC
      `);
      res.json(rows.rows || []);
    } catch (err: any) {
      console.error("[PO] List error:", err.message);
      res.status(500).json({ error: "Failed to list POs" });
    }
  });

  app.post("/api/po/generate", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const {
        projectName, supplierName, supplierVat, supplierAddress, supplierContact,
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
      const parsedItems = lineItems.map((item: any) => {
        const qty = parseFloat(item.qty) || 0;
        const price = parseFloat(item.pricePerUnit) || 0;
        subtotal += qty * price;
        return { ...item, qty, pricePerUnit: price };
      });
      const vatAmount = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vatAmount) * 100) / 100;

      const defaultPaymentTerms = `All invoicing is to be sent to ${EMERGENT_HEADER.accountsEmail}`;
      const pmName = projectManager || user.name;

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
        vat_amount: vatAmount,
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
          po_ref, po_number, project_name, supplier_name, supplier_vat,
          supplier_address, supplier_contact, line_items, subtotal, vat_amount,
          total, payment_terms, delivery_date, delivery_address, site_contact,
          comments, project_manager, status, created_by, pdf_data
        ) VALUES (
          ${poRef}, ${poNumber}, ${projectName},
          ${supplierName}, ${supplierVat || null},
          ${supplierAddress || null},
          ${supplierContact || null},
          ${JSON.stringify(parsedItems)}::jsonb,
          ${subtotal}, ${vatAmount}, ${total},
          ${paymentTerms || defaultPaymentTerms},
          ${deliveryDate || null},
          ${deliveryAddress || null},
          ${siteContact || null},
          ${comments || null},
          ${pmName},
          'draft', ${user.userId},
          ${pdfBuffer}
        ) RETURNING id
      `);

      const poId = insertResult.rows[0]?.id;

      logAuditFromReq(req, {
        entity: "purchase_order",
        entityId: poId,
        action: "create",
        details: { poRef, projectName, supplierName, total },
      });

      res.json({
        id: poId,
        poRef,
        poNumber,
        subtotal,
        vatAmount,
        total,
        pdfBase64: pdfBuffer.toString("base64"),
      });
    } catch (err: any) {
      console.error("[PO] Generate error:", err.message);
      res.status(500).json({ error: "Failed to generate PO" });
    }
  });

  app.get("/api/po/:projectName/:poId/pdf", requireAuth, async (req, res) => {
    try {
      const poIdNum = parseInt(req.params.poId);
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      const result = await db.execute(sql`
        SELECT pdf_data, po_ref FROM purchase_orders WHERE id = ${poIdNum}
      `);
      const row = result.rows[0];
      if (!row?.pdf_data) return res.status(404).json({ error: "PO not found" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${row.po_ref}.pdf"`);
      res.send(row.pdf_data);
    } catch (err: any) {
      console.error("[PO] PDF download error:", err.message);
      res.status(500).json({ error: "Failed to download PO PDF" });
    }
  });

  app.patch("/api/po/:poId/status", requireAuth, async (req, res) => {
    try {
      const poIdNum = parseInt(req.params.poId);
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      const { status } = req.body;
      const validStatuses = ["draft", "sent", "approved", "cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be: ${validStatuses.join(", ")}` });
      }

      if (status === "sent") {
        await db.execute(sql`
          UPDATE purchase_orders SET status = ${status}, updated_at = NOW(), sent_at = NOW()
          WHERE id = ${poIdNum}
        `);
      } else {
        await db.execute(sql`
          UPDATE purchase_orders SET status = ${status}, updated_at = NOW()
          WHERE id = ${poIdNum}
        `);
      }

      logAuditFromReq(req, {
        entity: "purchase_order",
        entityId: poIdNum,
        action: "update_status",
        details: { status },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[PO] Status update error:", err.message);
      res.status(500).json({ error: "Failed to update PO status" });
    }
  });

  app.delete("/api/po/:poId", requireAuth, async (req, res) => {
    try {
      const poIdNum = parseInt(req.params.poId);
      if (isNaN(poIdNum)) return res.status(400).json({ error: "Invalid PO ID" });

      await db.execute(sql`DELETE FROM purchase_orders WHERE id = ${poIdNum} AND status = 'draft'`);

      logAuditFromReq(req, {
        entity: "purchase_order",
        entityId: poIdNum,
        action: "delete",
        details: {},
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("[PO] Delete error:", err.message);
      res.status(500).json({ error: "Failed to delete PO" });
    }
  });
}

export { ensurePoTables };
