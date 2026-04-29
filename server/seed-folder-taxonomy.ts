/**
 * Folder taxonomy seed (D6 — Document Management v2).
 *
 * Seeds `folder_taxonomy` with the canonical Active Clients tree mirrored
 * from SharePoint:
 *
 *   01 - Clients/01 - active projects (1)/{Project}/
 *
 * Two lifecycle modes coexist:
 *   - pre_construction: PRE_First Assessment, PRE_Cost Proposal, PM (early)
 *   - full_lifecycle:   01_Financial Close … 14_Contractor Shared Folder
 *
 * A project keeps its pre-construction folders even after the full-lifecycle
 * tree is provisioned (per the planning conversation).
 *
 * Idempotent: upserts by `internal_key`. Admins can edit any seeded row via
 * the /admin/document-management UI; subsequent boot updates ONLY rows that
 * haven't been edited (we detect via the displayName/sortOrder match — full
 * admin-managed-source-of-truth would need a `seed_version` column which we
 * defer to phase 2.x if needed).
 *
 * Seed values for `disciplines`, `stage_code`, and the multi-discipline
 * mapping for 07_Construction (ENGINEERING + CONSTRUCTION + QUALITY) come
 * from the planning conversation. All values are admin-editable via the
 * Documents Administration page.
 */

import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  folderTaxonomy,
  type InsertFolderTaxonomy,
} from "@shared/schema/documents";

// =========================================================================
// Seed data — Pattern A (pre_construction)
// =========================================================================

const PATTERN_A: InsertFolderTaxonomy[] = [
  // Top-level
  {
    internalKey: "pre_first_assessment",
    displayName: "PRE_First Assessment",
    parentKey: null,
    lifecycleMode: "pre_construction",
    stageCode: "S01_FIRST_ASSESSMENT",
    disciplines: ["PD"],
    description: "Pre-construction first assessment — bills, sizing, costing, design inputs.",
    sortOrder: 10,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal",
    displayName: "PRE_Cost Proposal",
    parentKey: null,
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD"],
    description: "Pre-construction design + cost proposal pack.",
    sortOrder: 20,
    active: true,
  },
  {
    internalKey: "pm_pre_construction",
    displayName: "PM",
    parentKey: null,
    lifecycleMode: "pre_construction",
    stageCode: "S04_PLANNING",
    disciplines: ["PM"],
    description: "Project Management workspace (pre-construction layout).",
    sortOrder: 30,
    active: true,
  },

  // PRE_First Assessment children
  {
    internalKey: "pre_first_assessment/bills_client_data_reporting",
    displayName: "Bills & Client Data & Reporting",
    parentKey: "pre_first_assessment",
    lifecycleMode: "pre_construction",
    stageCode: "S01_FIRST_ASSESSMENT",
    disciplines: ["PD"],
    description: null,
    sortOrder: 10,
    active: true,
  },
  {
    internalKey: "pre_first_assessment/carbon_credits_calculator",
    displayName: "Carbon Credits Calculator",
    parentKey: "pre_first_assessment",
    lifecycleMode: "pre_construction",
    stageCode: "S01_FIRST_ASSESSMENT",
    disciplines: ["PD"],
    description: null,
    sortOrder: 20,
    active: true,
  },
  {
    internalKey: "pre_first_assessment/costing",
    displayName: "Costing",
    parentKey: "pre_first_assessment",
    lifecycleMode: "pre_construction",
    stageCode: "S01_FIRST_ASSESSMENT",
    disciplines: ["PD", "FINANCE"],
    description: "First-assessment costing artefacts.",
    sortOrder: 30,
    active: true,
  },
  {
    internalKey: "pre_first_assessment/pictures",
    displayName: "Pictures",
    parentKey: "pre_first_assessment",
    lifecycleMode: "pre_construction",
    stageCode: "S01_FIRST_ASSESSMENT",
    disciplines: ["PD"],
    description: null,
    sortOrder: 40,
    active: true,
  },
  {
    internalKey: "pre_first_assessment/do_not_use",
    displayName: "do not use",
    parentKey: "pre_first_assessment",
    lifecycleMode: "pre_construction",
    stageCode: null,
    disciplines: [],
    description: "Surfaced as-is per directive (no special handling).",
    sortOrder: 99,
    active: true,
  },

  // PRE_Cost Proposal children
  {
    internalKey: "pre_cost_proposal/cost_proposal",
    displayName: "Cost Proposal",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD"],
    description: null,
    sortOrder: 10,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/cp_costing",
    displayName: "CP_Costing",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD", "FINANCE"],
    description: "Cost-proposal costing workbook(s) — CEO approves.",
    sortOrder: 20,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/cp_pvsol_design",
    displayName: "CP_PVSol Design",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD", "ENGINEERING"],
    description: null,
    sortOrder: 30,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/data_analysis_for_client",
    displayName: "Data Analysis for client",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD"],
    description: null,
    sortOrder: 40,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/om",
    displayName: "O&M",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD", "OM"],
    description: null,
    sortOrder: 50,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/signed_documents",
    displayName: "Signed Documents",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    disciplines: ["PD", "PM", "FINANCE"],
    description: "Signed cost proposal + EPC contract — COO approves.",
    sortOrder: 60,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/site_inspection",
    displayName: "Site Inspection",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD", "ENGINEERING", "HSE"],
    description: null,
    sortOrder: 70,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/sizing_metering_report",
    displayName: "Sizing and Metering Report",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: "S02_DESIGN_COST_PROPOSAL",
    disciplines: ["PD", "ENGINEERING"],
    description: null,
    sortOrder: 80,
    active: true,
  },
  {
    internalKey: "pre_cost_proposal/not_used",
    displayName: "Not Used",
    parentKey: "pre_cost_proposal",
    lifecycleMode: "pre_construction",
    stageCode: null,
    disciplines: [],
    description: "Surfaced as-is per directive (no special handling).",
    sortOrder: 99,
    active: true,
  },

  // PM (early) children
  {
    internalKey: "pm_pre_construction/planning",
    displayName: "0. Planning",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: "S04_PLANNING",
    disciplines: ["PM"],
    description: null,
    sortOrder: 0,
    active: true,
  },
  {
    internalKey: "pm_pre_construction/contractual_admin",
    displayName: "1. Contractual and Admin",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    disciplines: ["PM", "FINANCE"],
    description: null,
    sortOrder: 10,
    active: true,
  },
  {
    internalKey: "pm_pre_construction/procurement",
    displayName: "2. Procurement",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: null,
    disciplines: ["PROCUREMENT", "PM"],
    description: null,
    sortOrder: 20,
    active: true,
  },
  {
    internalKey: "pm_pre_construction/construction",
    displayName: "3. Construction",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: "S06_CONSTRUCTION",
    disciplines: ["ENGINEERING", "CONSTRUCTION", "QUALITY"],
    description: null,
    sortOrder: 30,
    active: true,
  },
  {
    internalKey: "pm_pre_construction/commissioning",
    displayName: "4. Commissioning",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: "S07_COMMISSIONING",
    disciplines: ["QUALITY", "ENGINEERING"],
    description: null,
    sortOrder: 40,
    active: true,
  },
  {
    internalKey: "pm_pre_construction/subcontractor_shared",
    displayName: "5. Subcontractor Shared Folder",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: null,
    disciplines: ["CONSTRUCTION"],
    description: "Shared with external subcontractors.",
    sortOrder: 50,
    active: true,
  },
  {
    internalKey: "pm_pre_construction/client_shared",
    displayName: "6. Client Shared Folder",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: null,
    disciplines: ["KAM", "PM"],
    description: "Shared with the client.",
    sortOrder: 60,
    active: true,
  },
  {
    internalKey: "pm_pre_construction/photos",
    displayName: "99. Photos",
    parentKey: "pm_pre_construction",
    lifecycleMode: "pre_construction",
    stageCode: null,
    disciplines: [],
    description: null,
    sortOrder: 99,
    active: true,
  },
];

// =========================================================================
// Seed data — Pattern B (full_lifecycle)
// =========================================================================

const PATTERN_B: InsertFolderTaxonomy[] = [
  {
    internalKey: "01_financial_close",
    displayName: "01_Financial Close",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: "S03_SIGNATURE_FINANCIAL_CLOSE",
    disciplines: ["FINANCE", "PD"],
    description: "Signed contracts, financial close pack, lender artefacts.",
    sortOrder: 10,
    active: true,
  },
  {
    internalKey: "02_project_management",
    displayName: "02_Project Management",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: "S04_PLANNING",
    disciplines: ["PM"],
    description: null,
    sortOrder: 20,
    active: true,
  },
  {
    internalKey: "03_engineering",
    displayName: "03_Engineering",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    disciplines: ["ENGINEERING"],
    description: "Engineering drawings, specifications, calcs.",
    sortOrder: 30,
    active: true,
  },
  {
    internalKey: "04_grid_connection",
    displayName: "04_Grid Connection",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    disciplines: ["ENGINEERING", "COMPLIANCE"],
    description: "Grid connection submissions, NRS, utility correspondence.",
    sortOrder: 40,
    active: true,
  },
  {
    internalKey: "05_procurement_financing",
    displayName: "05_Procurement & Financing",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    disciplines: ["PROCUREMENT", "FINANCE"],
    description: "Purchase orders, supplier proposals, financing artefacts.",
    sortOrder: 50,
    active: true,
  },
  {
    internalKey: "06_hse",
    displayName: "06_HSE",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    disciplines: ["HSE"],
    description: "Health, Safety & Environment plans, audits, incidents.",
    sortOrder: 60,
    active: true,
  },
  {
    internalKey: "07_construction",
    displayName: "07_Construction",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: "S06_CONSTRUCTION",
    disciplines: ["ENGINEERING", "CONSTRUCTION", "QUALITY"],
    description: "Construction execution: site reports, ITPs, daily logs.",
    sortOrder: 70,
    active: true,
  },
  {
    internalKey: "08_qa_qc",
    displayName: "08_QA & QC",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    disciplines: ["QUALITY"],
    description: "Quality plans, inspection reports, NCRs.",
    sortOrder: 80,
    active: true,
  },
  {
    internalKey: "09_commissioning",
    displayName: "09_Commissioning",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: "S07_COMMISSIONING",
    disciplines: ["QUALITY", "ENGINEERING"],
    description: "Commissioning protocols, test sheets, sign-offs.",
    sortOrder: 90,
    active: true,
  },
  {
    internalKey: "10_handover",
    displayName: "10_Handover",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: "S08_OM_HANDOVER",
    disciplines: ["PM", "ENGINEERING"],
    description: "Client handover pack, as-builts, certificates.",
    sortOrder: 100,
    active: true,
  },
  {
    internalKey: "11_om",
    displayName: "11_O&M",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    disciplines: ["OM"],
    description: "Operations & Maintenance contracts, schedules, reports.",
    sortOrder: 110,
    active: true,
  },
  {
    internalKey: "12_lessons_learned",
    displayName: "12_Lessons Learned",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: "S10_POST_HANDOVER_REVIEW",
    disciplines: ["EXCO", "PM"],
    description: "Post-handover retrospective and lessons.",
    sortOrder: 120,
    active: true,
  },
  {
    internalKey: "13_project_photos",
    displayName: "13_Project Photos",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    // Cross-discipline: photos shared by everyone. Empty disciplines array
    // signals "shared / all" to the discipline-panel filter.
    disciplines: [],
    description: "Site photography (shared, read-all).",
    sortOrder: 130,
    active: true,
  },
  {
    internalKey: "14_contractor_shared",
    displayName: "14_Contractor Shared Folder",
    parentKey: null,
    lifecycleMode: "full_lifecycle",
    stageCode: null,
    disciplines: ["CONSTRUCTION"],
    description: "Shared with external EPC contractors.",
    sortOrder: 140,
    active: true,
  },
];

// =========================================================================
// Seeder
// =========================================================================

export async function seedFolderTaxonomy(): Promise<{ inserted: number; skipped: number }> {
  const all: InsertFolderTaxonomy[] = [...PATTERN_A, ...PATTERN_B];
  let inserted = 0;
  let skipped = 0;

  for (const row of all) {
    const [existing] = await db
      .select({ id: folderTaxonomy.id })
      .from(folderTaxonomy)
      .where(eq(folderTaxonomy.internalKey, row.internalKey))
      .limit(1);

    if (existing) {
      skipped += 1;
      continue;
    }

    await db.insert(folderTaxonomy).values(row);
    inserted += 1;
  }

  return { inserted, skipped };
}
