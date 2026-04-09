import type { Express } from 'express';
import type { Server } from 'http';
import { registerRoutes as registerLegacyRoutes } from '../routes';
import { registerTemplateGovernanceRoutes } from './template-governance-routes';

export async function registerRoutes(httpServer: Server, app: Express) {
  registerTemplateGovernanceRoutes(app);
  return registerLegacyRoutes(httpServer, app);
}
