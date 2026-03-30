import type { Express } from 'express';
import type { Server } from 'http';
import authRouter from './auth.routes';
import usersRouter from './users.routes';
import projectsRouter from './projects.routes';
import tasksRouter from './tasks.routes';
import financialsRouter from './financials.routes';
import engineeringRouter from './engineering.routes';
import qualityRouter from './quality.routes';
import dashboardRouter from './dashboard.routes';
import reportsRouter from './reports.routes';
import adminRouter from './admin.routes';
import importsRouter from './imports.routes';
import microsoftRouter from './microsoft.routes';
import notificationsRouter from './notifications.routes';
import documentsRouter from './documents.routes';
import pipelineRouter from './pipeline.routes';
import { registerRoutes as registerLegacyRoutes } from '../routes';
import { registerTemplateGovernanceRoutes } from './template-governance-routes';

export function registerDomainRouters(app: Express) {
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/financials', financialsRouter);
  app.use('/api/engineering', engineeringRouter);
  app.use('/api/quality', qualityRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/microsoft', microsoftRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/pipeline', pipelineRouter);
}

export async function registerRoutes(httpServer: Server, app: Express) {
  registerDomainRouters(app);
  registerTemplateGovernanceRoutes(app);
  return registerLegacyRoutes(httpServer, app);
}
