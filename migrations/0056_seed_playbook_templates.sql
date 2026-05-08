-- Migration 0056 — seed the 18 companion templates.
--
-- Plan v3 § 2.2 / D.3: the canonical phase_template registry was empty
-- (Wave-0 finding § 0.4: "0 of 13 playbook templates seeded"). This
-- migration inserts one row per template — the 13 named in
-- docs/operating-model/playbook-v2.0.md "Companion Templates" (lines
-- 1233-1253), plus 5 additional operational templates surfaced by the
-- COO during PR #852 review (project brief, project introduction,
-- commissioning document, two red-team reviews). Each row is mapped to
-- its canonical phase code from shared/phases.ts. The actual template
-- documents live in SharePoint; this seed is the registry pointer.
--
-- Idempotency: phase_template has no unique constraint on
-- (phase, name, version), so each row uses INSERT ... WHERE NOT EXISTS
-- to be safe under re-application. The COO can adjust per-row phase
-- mapping later via UPDATE without re-running this migration.
--
-- Mapping rationale per template (verbatim from the playbook column
-- "Purpose"; phase code from shared/phases.ts PHASES list):
--
--   1  First Assessment Checklist            → S01_FIRST_ASSESSMENT          (playbook: "Stage 1")
--   2  Feasibility Assumptions Register      → S02_DESIGN_COST_PROPOSAL      (playbook: "Stage 2")
--   3  Cost Proposal Approval Sheet          → S02_DESIGN_COST_PROPOSAL      (playbook: "Stage 2 sign-off")
--   4  Financial Close Gate                  → S03_SIGNATURE_FINANCIAL_CLOSE (playbook: "Stage 3 gate criteria")
--   5  PD-to-PM Handover                     → S03_SIGNATURE_FINANCIAL_CLOSE (playbook: "Trigger artefact at FC")
--   6  Construction Readiness Gate           → S04_PLANNING                  (playbook: "Stage 4 exit gate")
--   7  HSE File Checklist                    → S04_PLANNING                  (playbook: "before site work commences")
--   8  Commissioning Readiness Gate          → S06_CONSTRUCTION              (exit-from-Construction gate; mirrors #6 pattern — readiness gates live in the outgoing phase)
--   9  O&M Handover to Matriarch             → S08_OM_HANDOVER               (Stage 7)
--  10  Client Handover Checklist             → S09_CLIENT_HANDOVER           (Stage 8)
--  11  3-Month Post-HO Review                → S10_POST_HANDOVER_REVIEW      (Stage 9 — canonical phase added 2026-04-24, migration 0030)
--  12  Compliance Handover                   → S9B_COMPLIANCE_HANDOVER       (Stage 10 — canonical phase added 2026-04-24, migration 0030)
--  13  Hold / Blocked Register               → S_HOLD                        (terminal phase template)
--  14  Project Brief Template                → S04_PLANNING                  (PM hands to installer during planning)
--  15  Commissioning Document                → S07_COMMISSIONING             (engineering + installer fill in during commissioning & QA)
--  16  Pre-Commissioning Red Team Review     → S06_CONSTRUCTION              (gates entry to commissioning; outgoing-phase pattern)
--  17  Post-Works-Complete Red Team Review   → S07_COMMISSIONING             (post-works-complete review during commissioning & QA)
--  18  Project Introduction                  → S04_PLANNING                  (PM-led kickoff with the client during planning)

-- 1. First Assessment Checklist
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S01_FIRST_ASSESSMENT', 'First Assessment Checklist', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S01_FIRST_ASSESSMENT' AND name = 'First Assessment Checklist' AND version = 1
);

-- 2. Feasibility Assumptions Register
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S02_DESIGN_COST_PROPOSAL', 'Feasibility Assumptions Register', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S02_DESIGN_COST_PROPOSAL' AND name = 'Feasibility Assumptions Register' AND version = 1
);

-- 3. Cost Proposal Approval Sheet
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S02_DESIGN_COST_PROPOSAL', 'Cost Proposal Approval Sheet', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S02_DESIGN_COST_PROPOSAL' AND name = 'Cost Proposal Approval Sheet' AND version = 1
);

-- 4. Financial Close Gate
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S03_SIGNATURE_FINANCIAL_CLOSE', 'Financial Close Gate', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S03_SIGNATURE_FINANCIAL_CLOSE' AND name = 'Financial Close Gate' AND version = 1
);

-- 5. PD-to-PM Handover
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S03_SIGNATURE_FINANCIAL_CLOSE', 'PD-to-PM Handover', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S03_SIGNATURE_FINANCIAL_CLOSE' AND name = 'PD-to-PM Handover' AND version = 1
);

-- 6. Construction Readiness Gate
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S04_PLANNING', 'Construction Readiness Gate', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S04_PLANNING' AND name = 'Construction Readiness Gate' AND version = 1
);

-- 7. HSE File Checklist
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S04_PLANNING', 'HSE File Checklist', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S04_PLANNING' AND name = 'HSE File Checklist' AND version = 1
);

-- 8. Commissioning Readiness Gate
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S06_CONSTRUCTION', 'Commissioning Readiness Gate', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S06_CONSTRUCTION' AND name = 'Commissioning Readiness Gate' AND version = 1
);

-- 9. O&M Handover to Matriarch
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S08_OM_HANDOVER', 'O&M Handover to Matriarch', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S08_OM_HANDOVER' AND name = 'O&M Handover to Matriarch' AND version = 1
);

-- 10. Client Handover Checklist
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S09_CLIENT_HANDOVER', 'Client Handover Checklist', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S09_CLIENT_HANDOVER' AND name = 'Client Handover Checklist' AND version = 1
);

-- 11. 3-Month Post-HO Review
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S10_POST_HANDOVER_REVIEW', '3-Month Post-HO Review', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S10_POST_HANDOVER_REVIEW' AND name = '3-Month Post-HO Review' AND version = 1
);

-- 12. Compliance Handover
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S9B_COMPLIANCE_HANDOVER', 'Compliance Handover', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S9B_COMPLIANCE_HANDOVER' AND name = 'Compliance Handover' AND version = 1
);

-- 13. Hold / Blocked Register
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S_HOLD', 'Hold / Blocked Register', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S_HOLD' AND name = 'Hold / Blocked Register' AND version = 1
);

-- 14. Project Brief Template
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S04_PLANNING', 'Project Brief Template', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S04_PLANNING' AND name = 'Project Brief Template' AND version = 1
);

-- 15. Commissioning Document
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S07_COMMISSIONING', 'Commissioning Document', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S07_COMMISSIONING' AND name = 'Commissioning Document' AND version = 1
);

-- 16. Pre-Commissioning Red Team Review
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S06_CONSTRUCTION', 'Pre-Commissioning Red Team Review', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S06_CONSTRUCTION' AND name = 'Pre-Commissioning Red Team Review' AND version = 1
);

-- 17. Post-Works-Complete Red Team Review
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S07_COMMISSIONING', 'Post-Works-Complete Red Team Review', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S07_COMMISSIONING' AND name = 'Post-Works-Complete Red Team Review' AND version = 1
);

-- 18. Project Introduction
INSERT INTO phase_template (phase, name, version, is_active, created_at, updated_at)
SELECT 'S04_PLANNING', 'Project Introduction', 1, TRUE, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM phase_template
  WHERE phase = 'S04_PLANNING' AND name = 'Project Introduction' AND version = 1
);
