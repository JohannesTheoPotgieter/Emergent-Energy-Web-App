/**
 * MyTool Routes — Extracted from server/routes.ts
 *
 * This module is the extraction target for all /api/mytool/* route handlers.
 * During the migration window, the handlers still exist in routes.ts (marked
 * with EXTRACTED comments). Once parity is verified, the marked handlers
 * in routes.ts will be removed.
 *
 * Current status: INFRASTRUCTURE READY
 * - Route handlers are still in routes.ts (34 handlers)
 * - This file registers as a no-op stub during the verification window
 * - Full handler migration happens in the next PR after API test verification
 *
 * Handlers to migrate (34 total):
 *   GET    /api/mytool/settings
 *   PUT    /api/mytool/settings
 *   GET    /api/mytool/tasks
 *   POST   /api/mytool/tasks
 *   PATCH  /api/mytool/tasks/:id
 *   DELETE /api/mytool/tasks/:id
 *   GET    /api/mytool/tasks/:id/dependencies
 *   POST   /api/mytool/tasks/:id/dependencies
 *   DELETE /api/mytool/tasks/:id/dependencies/:dependencyId
 *   GET    /api/mytool/recurrence-templates
 *   POST   /api/mytool/recurrence-templates
 *   GET    /api/mytool/timeblocks
 *   POST   /api/mytool/timeblocks
 *   PATCH  /api/mytool/timeblocks/:id
 *   DELETE /api/mytool/timeblocks/:id
 *   GET    /api/mytool/daily-review
 *   PUT    /api/mytool/daily-review
 *   GET    /api/mytool/escalated-priorities
 *   GET    /api/mytool/preferences
 *   PUT    /api/mytool/preferences
 *   GET    /api/mytool/email-links
 *   POST   /api/mytool/email-links
 *   DELETE /api/mytool/email-links/:id
 *   GET    /api/mytool/dod-templates
 *   POST   /api/mytool/dod-templates
 *   DELETE /api/mytool/dod-templates/:id
 *   POST   /api/mytool/support-ticket
 *   GET    /api/mytool/support-tickets
 *   GET    /api/mytool/triage-rules
 *   POST   /api/mytool/triage-rules
 *   PATCH  /api/mytool/triage-rules/:id
 *   DELETE /api/mytool/triage-rules/:id
 *   GET    /api/mytool/triage-inbox
 *   GET    /api/mytool/unclassified-tasks
 */

import type { Express } from "express";

export function registerMytoolRoutes(_app: Express): void {
  // Phase 1: Infrastructure stub. Handlers still in routes.ts during verification window.
  // Phase 2 (next PR): Move actual handler code here and remove from routes.ts.
}
