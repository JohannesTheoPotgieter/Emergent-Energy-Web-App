import pg from "pg";
import fs from "fs";
import path from "path";

const { Pool } = pg;

const START = "2025-09-01";
const END = "2026-02-28";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to run finance proof extract against reporting/production DB.");
  }
  return url;
}

async function run() {
  const databaseUrl = requireDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const cosSql = `
      WITH rows AS (
        SELECT
          ncl.id,
          ncl.project_name AS project,
          ncl.counterparty_name AS supplier,
          ncl.invoice_number,
          ncl.po_number,
          ncl.status,
          ncl.cost_line_status,
          ncl.invoice_date,
          ncl.invoice_date_confirmed,
          ncl.invoice_date_font_color,
          ncl.paid_date,
          ncl.amount_ex_vat::numeric AS app_amount,
          ql.qb_txn_date::date AS qb_date_used,
          ql.qb_amount::numeric AS qb_amount,
          ql.id AS link_id
        FROM normalized_cost_lines ncl
        LEFT JOIN quickbooks_invoice_links ql
          ON ql.app_entity_type = 'cost_line'
         AND ql.qb_entity_type = 'bill'
         AND ql.app_entity_id = ncl.id
         AND ql.deleted_at IS NULL
        WHERE (COALESCE(ncl.invoice_date, ncl.paid_date) BETWEEN $1::date AND $2::date)
      )
      SELECT
        project,
        supplier,
        invoice_number,
        po_number,
        status,
        cost_line_status,
        invoice_date,
        invoice_date_confirmed,
        invoice_date_font_color,
        COALESCE(invoice_date, paid_date) AS app_recognition_date_used,
        qb_date_used,
        CASE
          WHEN COALESCE(NULLIF(trim(invoice_number), ''), '') <> ''
               AND (COALESCE(invoice_date_confirmed, false) = true OR lower(COALESCE(invoice_date_font_color, '')) = 'black')
            THEN 'realised'
          WHEN COALESCE(NULLIF(trim(invoice_number), ''), '') <> '' OR COALESCE(NULLIF(trim(po_number), ''), '') <> ''
            THEN 'committed'
          ELSE 'planned'
        END AS current_bucket,
        CASE
          WHEN link_id IS NULL THEN 'app_only'
          WHEN abs(COALESCE(app_amount,0) - COALESCE(qb_amount,0)) > 1 THEN 'exception'
          WHEN to_char(COALESCE(invoice_date, paid_date), 'YYYY-MM') <> to_char(qb_date_used, 'YYYY-MM') THEN 'exception'
          ELSE 'matched'
        END AS recon_status,
        CASE
          WHEN link_id IS NULL THEN 'Sync error'
          WHEN COALESCE(NULLIF(trim(po_number), ''), '') = '' THEN 'Missing PO'
          WHEN COALESCE(NULLIF(trim(invoice_number), ''), '') = '' THEN 'Missing invoice number'
          WHEN abs(COALESCE(app_amount,0) - COALESCE(qb_amount,0)) > 1 THEN 'Amount mismatch'
          WHEN to_char(COALESCE(invoice_date, paid_date), 'YYYY-MM') <> to_char(qb_date_used, 'YYYY-MM') THEN 'Posted to wrong month'
          ELSE NULL
        END AS exception_reason_code
      FROM rows
      ORDER BY app_recognition_date_used, project
      LIMIT 20
    `;

    const revSql = `
      WITH rows AS (
        SELECT
          nrl.id,
          nrl.project_name AS project,
          COALESCE(ql.qb_counterparty_name, '') AS customer,
          nrl.invoice_number,
          nrl.status,
          nrl.invoice_date,
          nrl.paid_date,
          nrl.in_bank_date,
          nrl.amount_ex_vat::numeric AS app_amount,
          ql.qb_txn_date::date AS qb_date_used,
          ql.qb_amount::numeric AS qb_amount,
          ql.id AS link_id
        FROM normalized_revenue_lines nrl
        LEFT JOIN quickbooks_invoice_links ql
          ON ql.app_entity_type = 'revenue_line'
         AND ql.qb_entity_type = 'invoice'
         AND ql.app_entity_id = nrl.id
         AND ql.deleted_at IS NULL
        WHERE (COALESCE(nrl.paid_date, nrl.in_bank_date, nrl.invoice_date) BETWEEN $1::date AND $2::date)
      )
      SELECT
        project,
        customer,
        invoice_number,
        status,
        COALESCE(paid_date, in_bank_date, invoice_date) AS app_recognition_date_used,
        qb_date_used,
        CASE
          WHEN COALESCE(paid_date, in_bank_date) IS NOT NULL THEN 'realised'
          ELSE 'unrealised'
        END AS current_bucket,
        CASE
          WHEN link_id IS NULL THEN 'app_only'
          WHEN abs(COALESCE(app_amount,0) - COALESCE(qb_amount,0)) > 1 THEN 'exception'
          WHEN to_char(COALESCE(paid_date, in_bank_date, invoice_date), 'YYYY-MM') <> to_char(qb_date_used, 'YYYY-MM') THEN 'exception'
          ELSE 'matched'
        END AS recon_status,
        CASE
          WHEN link_id IS NULL THEN 'Excluded by business rule'
          WHEN COALESCE(paid_date, in_bank_date) IS NULL THEN 'Missing payment receipt date'
          WHEN COALESCE(NULLIF(trim(invoice_number), ''), '') = '' THEN 'Missing invoice number'
          WHEN abs(COALESCE(app_amount,0) - COALESCE(qb_amount,0)) > 1 THEN 'Amount mismatch'
          WHEN to_char(COALESCE(paid_date, in_bank_date, invoice_date), 'YYYY-MM') <> to_char(qb_date_used, 'YYYY-MM') THEN 'Posted to wrong month'
          ELSE NULL
        END AS exception_reason_code
      FROM rows
      ORDER BY app_recognition_date_used, project
      LIMIT 20
    `;

    const [cos, revenue] = await Promise.all([
      pool.query(cosSql, [START, END]),
      pool.query(revSql, [START, END]),
    ]);

    const out = {
      generatedAt: new Date().toISOString(),
      period: { start: START, end: END },
      cos: cos.rows,
      revenue: revenue.rows,
      ruleConfirmations: {
        cosActualsContract:
          "Current implementation classifies realised COS via invoice number + invoice-date confirmation signals; this extract exposes status/cost_line_status side-by-side for COO confirmation.",
        revenueMonthLogic:
          "App recognition month uses paid_date/in_bank_date fallback to invoice_date. QB date uses quickbooks link snapshot qb_txn_date (txnDate fallback).",
      },
    };

    const outDir = path.resolve("qa/artifacts");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "finance-proof-extract-sep2025-feb2026.json");
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`Wrote proof extract to ${outPath}`);
    console.log(`COS rows: ${cos.rowCount}, Revenue rows: ${revenue.rowCount}`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error("[finance-proof-extract] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
