-- Migration 0012: Canonical phase backfill (production data)
-- Generated 2026-04-21 from production read-replica state.
-- Normalizes project_info.phase + execution_phase to the canonical 10-phase
-- lifecycle defined in shared/phases.ts. Off-lifecycle labels (Hold/Internal/
-- Closed/TBC/DLP) are moved out of phase into project_status / in_dlp.
-- DLP-flagged projects are mapped to O&M Handover (the lifecycle phase DLP
-- belongs to) with in_dlp=true preserving the warranty-period context.
-- Active projects with no signal at all default to First Assessment.
-- Pure DML — no schema changes. Idempotent: each statement has a precondition.
BEGIN;

INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 257, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 257 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 257;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 259, 'Commercial Close Out', 'Post-Handover Review', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 259 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Post-Handover Review','__NULL__'));
UPDATE project_info SET phase = 'Post-Handover Review', execution_phase = 'Post-Handover Review', phase_updated_at = NOW() WHERE id = 259;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 260, 'Commercial Close Out', 'Post-Handover Review', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 260 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Post-Handover Review','__NULL__'));
UPDATE project_info SET phase = 'Post-Handover Review', execution_phase = 'Post-Handover Review', phase_updated_at = NOW() WHERE id = 260;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 261, 'DLP', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 261 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', in_dlp = TRUE, phase_updated_at = NOW() WHERE id = 261;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 262, 'QA', 'Commissioning', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 262 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Commissioning','__NULL__'));
UPDATE project_info SET phase = 'Commissioning', execution_phase = 'Commissioning', phase_updated_at = NOW() WHERE id = 262;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 265, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 265 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 265;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 266, 'Internal', 'Planning', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 266 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Planning','__NULL__'));
UPDATE project_info SET phase = 'Planning', execution_phase = 'Planning', project_status = 'internal', phase_updated_at = NOW() WHERE id = 266;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 267, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 267 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 267;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 268, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 268 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 268;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 273, 'Commercial Close Out', 'Post-Handover Review', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 273 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Post-Handover Review','__NULL__'));
UPDATE project_info SET phase = 'Post-Handover Review', execution_phase = 'Post-Handover Review', phase_updated_at = NOW() WHERE id = 273;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 274, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 274 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 274;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 275, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 275 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 275;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 276, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 276 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 276;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 277, 'DLP', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 277 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', in_dlp = TRUE, phase_updated_at = NOW() WHERE id = 277;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 278, 'DLP', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 278 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', in_dlp = TRUE, phase_updated_at = NOW() WHERE id = 278;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 283, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 283 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 283;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 286, 'QA', 'Commissioning', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 286 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Commissioning','__NULL__'));
UPDATE project_info SET phase = 'Commissioning', execution_phase = 'Commissioning', phase_updated_at = NOW() WHERE id = 286;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 287, 'DLP', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 287 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', in_dlp = TRUE, phase_updated_at = NOW() WHERE id = 287;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 290, 'Commercial Close Out', 'Post-Handover Review', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 290 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Post-Handover Review','__NULL__'));
UPDATE project_info SET phase = 'Post-Handover Review', execution_phase = 'Post-Handover Review', phase_updated_at = NOW() WHERE id = 290;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 294, 'QA', 'Commissioning', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 294 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Commissioning','__NULL__'));
UPDATE project_info SET phase = 'Commissioning', execution_phase = 'Commissioning', phase_updated_at = NOW() WHERE id = 294;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 297, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 297 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 297;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 298, 'Commercial Close Out', 'Post-Handover Review', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 298 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Post-Handover Review','__NULL__'));
UPDATE project_info SET phase = 'Post-Handover Review', execution_phase = 'Post-Handover Review', phase_updated_at = NOW() WHERE id = 298;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 300, 'QA', 'Commissioning', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 300 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Commissioning','__NULL__'));
UPDATE project_info SET phase = 'Commissioning', execution_phase = 'Commissioning', phase_updated_at = NOW() WHERE id = 300;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 303, 'Commercial Close Out', 'Post-Handover Review', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 303 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Post-Handover Review','__NULL__'));
UPDATE project_info SET phase = 'Post-Handover Review', execution_phase = 'Post-Handover Review', phase_updated_at = NOW() WHERE id = 303;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 304, 'Commercial Close Out', 'Post-Handover Review', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 304 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Post-Handover Review','__NULL__'));
UPDATE project_info SET phase = 'Post-Handover Review', execution_phase = 'Post-Handover Review', phase_updated_at = NOW() WHERE id = 304;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 305, 'QA', 'Commissioning', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 305 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Commissioning','__NULL__'));
UPDATE project_info SET phase = 'Commissioning', execution_phase = 'Commissioning', phase_updated_at = NOW() WHERE id = 305;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 306, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 306 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 306;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 307, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 307 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 307;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 309, 'Handover', 'O&M Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 309 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('O&M Handover','__NULL__'));
UPDATE project_info SET phase = 'O&M Handover', execution_phase = 'O&M Handover', phase_updated_at = NOW() WHERE id = 309;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 310, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 310 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 310;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 311, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 311 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 311;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 312, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 312 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 312;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 313, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 313 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 313;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 314, 'Hold', 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 314 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', project_status = 'hold', phase_updated_at = NOW() WHERE id = 314;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 315, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 315 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 315;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 316, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 316 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 316;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 317, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 317 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 317;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 318, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 318 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 318;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 319, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 319 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 319;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 322, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 322 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 322;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 327, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 327 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 327;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 328, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 328 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 328;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 329, 'Internal', 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 329 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', project_status = 'internal', phase_updated_at = NOW() WHERE id = 329;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 332, 'Hold', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 332 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', project_status = 'hold', phase_updated_at = NOW() WHERE id = 332;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 333, 'Hold', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 333 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', project_status = 'hold', phase_updated_at = NOW() WHERE id = 333;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 334, 'Hold', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 334 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', project_status = 'hold', phase_updated_at = NOW() WHERE id = 334;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 335, 'Hold', 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 335 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', project_status = 'hold', phase_updated_at = NOW() WHERE id = 335;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 336, 'Hold', 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 336 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', project_status = 'hold', phase_updated_at = NOW() WHERE id = 336;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 337, 'Hold', 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 337 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', project_status = 'hold', phase_updated_at = NOW() WHERE id = 337;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 344, 'Cost Proposal', 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 344 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 344;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 345, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 345 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 345;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 346, NULL, 'Compliance Handover', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 346 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Compliance Handover','__NULL__'));
UPDATE project_info SET phase = 'Compliance Handover', execution_phase = 'Compliance Handover', phase_updated_at = NOW() WHERE id = 346;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 347, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 347 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 347;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 348, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 348 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 348;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 349, NULL, 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 349 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 349;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 350, NULL, 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 350 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 350;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 351, NULL, 'Financial Close', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 351 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Financial Close','__NULL__'));
UPDATE project_info SET phase = 'Financial Close', execution_phase = 'Financial Close', phase_updated_at = NOW() WHERE id = 351;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 352, NULL, 'Financial Close', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 352 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Financial Close','__NULL__'));
UPDATE project_info SET phase = 'Financial Close', execution_phase = 'Financial Close', phase_updated_at = NOW() WHERE id = 352;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 353, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 353 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 353;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 354, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 354 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 354;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 355, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 355 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 355;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 356, NULL, 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 356 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 356;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 357, NULL, 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 357 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 357;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 358, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 358 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 358;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 359, NULL, 'First Assessment', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 359 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('First Assessment','__NULL__'));
UPDATE project_info SET phase = 'First Assessment', execution_phase = 'First Assessment', phase_updated_at = NOW() WHERE id = 359;
INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
SELECT 362, NULL, 'Design & Cost Proposal', 22, 'canonical-phase-backfill 2026-04-21', NOW()
WHERE EXISTS (SELECT 1 FROM project_info WHERE id = 362 AND COALESCE(NULLIF(TRIM(phase),''),'__NULL__') IS DISTINCT FROM COALESCE('Design & Cost Proposal','__NULL__'));
UPDATE project_info SET phase = 'Design & Cost Proposal', execution_phase = 'Design & Cost Proposal', phase_updated_at = NOW() WHERE id = 362;

COMMIT;
-- Summary: 66 project_info UPDATEs, 66 project_phase_history INSERTs
