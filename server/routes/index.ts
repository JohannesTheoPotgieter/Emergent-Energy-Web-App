import type { Express } from 'express';
import type { Server } from 'http';
import { registerRoutes as registerLegacyRoutes } from '../routes';
import { registerTemplateGovernanceRoutes } from './template-governance-routes';
import { registerQuickBooksRoutes } from '../quickbooks-routes';
import { registerQuickBooksInvoiceMatchRoutes } from './quickbooks-invoice-matches.routes';
import { registerFinanceTrustRoutes } from './finance-trust-routes';
import { registerFinanceLinesRoutes } from './finance-lines.routes';
import { registerPdIntakeRoutes } from './pd-intake.routes';
// D6 Phase 5 — `registerControlledDocumentRoutes` is the legacy
// controlled-documents flow. The Document Management v2 rebuild routes
// every approval through the canonical `approvals` table via
// `managed-document-approvals.routes.ts`. Import is kept for type
// reference but the call site is intentionally retired below.
// Tracker: drop `documents.routes.ts` + `controlled-documents-repository.ts`
// once D6 ships and the destructive cleanup migration runs.
// import { registerControlledDocumentRoutes } from './documents.routes';
import { registerImpactRoutes } from './impact.routes';
import { registerEmailLinksRoutes } from './email-links.routes';
import { registerScreenSettingsRoutes } from './admin-screen-settings.routes';
import { registerExceptionDashboardRoutes } from './exception-dashboard.routes';
import { registerDocumentManagementRoutes } from './document-management.routes';
import { registerDocumentCommentsRoutes } from './document-comments.routes';
import { registerDocumentManagementAdminRoutes } from './document-management-admin.routes';
import { registerDocumentProvisioningRoutes } from './document-provisioning.routes';
import { registerManagedDocumentApprovalRoutes } from './managed-document-approvals.routes';
import { registerDocumentReadinessRoutes } from './document-readiness.routes';
import { registerProjectDocumentRegisterRoutes } from './project-document-register.routes';
import { registerTrackerReplicaRoutes } from './tracker-replica.routes';
import { registerExcelVsAppRoutes } from './excel-vs-app.routes';
import { registerReconciliationRoutes } from './reconciliation.routes';
import { registerQualityTasksRoutes } from './quality-tasks.routes';
import { registerStandupSessionsRoutes } from './standup-sessions.routes';
import { registerDeliveryMilestonesRoutes } from './delivery-milestones.routes';
import { registerMyQueueRoutes } from './my-queue.routes';

export async function registerRoutes(httpServer: Server, app: Express) {
  registerTemplateGovernanceRoutes(app);
  registerQuickBooksRoutes(app);
  registerQuickBooksInvoiceMatchRoutes(app);
  registerFinanceTrustRoutes(app);
  registerFinanceLinesRoutes(app);
  registerPdIntakeRoutes(app);
  // registerControlledDocumentRoutes(app); — retired in D6 Phase 5.
  registerImpactRoutes(app);
  registerEmailLinksRoutes(app);
  registerScreenSettingsRoutes(app);
  registerExceptionDashboardRoutes(app);
  registerDocumentManagementRoutes(app);
  registerDocumentCommentsRoutes(app);
  registerDocumentManagementAdminRoutes(app);
  registerDocumentProvisioningRoutes(app);
  registerManagedDocumentApprovalRoutes(app);
  registerDocumentReadinessRoutes(app);
  registerProjectDocumentRegisterRoutes(app);
  registerTrackerReplicaRoutes(app);
  registerExcelVsAppRoutes(app);
  registerReconciliationRoutes(app);
  registerQualityTasksRoutes(app);
  registerStandupSessionsRoutes(app);
  registerDeliveryMilestonesRoutes(app);
  registerMyQueueRoutes(app);
  return registerLegacyRoutes(httpServer, app);
}
