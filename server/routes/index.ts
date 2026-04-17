import type { Express } from 'express';
import type { Server } from 'http';
import { registerRoutes as registerLegacyRoutes } from '../routes';
import { registerTemplateGovernanceRoutes } from './template-governance-routes';
import { registerQuickBooksRoutes } from '../quickbooks-routes';
import { registerFinanceTrustRoutes } from './finance-trust-routes';
import { registerPdIntakeRoutes } from './pd-intake.routes';

export async function registerRoutes(httpServer: Server, app: Express) {
  registerTemplateGovernanceRoutes(app);
  registerQuickBooksRoutes(app);
  registerFinanceTrustRoutes(app);
  registerPdIntakeRoutes(app);
  return registerLegacyRoutes(httpServer, app);
}
