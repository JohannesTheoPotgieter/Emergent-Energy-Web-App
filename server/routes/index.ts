import type { Express } from 'express';
import type { Server } from 'http';
import { registerRoutes as registerLegacyRoutes } from '../routes';
import { registerTemplateGovernanceRoutes } from './template-governance-routes';
import { registerQuickBooksRoutes } from '../quickbooks-routes';
import { registerFinanceTrustRoutes } from './finance-trust-routes';
import { registerPdIntakeRoutes } from './pd-intake.routes';
import { registerControlledDocumentRoutes } from './documents.routes';
import { registerImpactRoutes } from './impact.routes';
import { registerEmailLinksRoutes } from './email-links.routes';
import { registerScreenSettingsRoutes } from './admin-screen-settings.routes';
import { registerExceptionDashboardRoutes } from './exception-dashboard.routes';
import { registerDocumentManagementRoutes } from './document-management.routes';
import { registerDocumentCommentsRoutes } from './document-comments.routes';
import { registerDocumentManagementAdminRoutes } from './document-management-admin.routes';

export async function registerRoutes(httpServer: Server, app: Express) {
  registerTemplateGovernanceRoutes(app);
  registerQuickBooksRoutes(app);
  registerFinanceTrustRoutes(app);
  registerPdIntakeRoutes(app);
  registerControlledDocumentRoutes(app);
  registerImpactRoutes(app);
  registerEmailLinksRoutes(app);
  registerScreenSettingsRoutes(app);
  registerExceptionDashboardRoutes(app);
  registerDocumentManagementRoutes(app);
  registerDocumentCommentsRoutes(app);
  registerDocumentManagementAdminRoutes(app);
  return registerLegacyRoutes(httpServer, app);
}
