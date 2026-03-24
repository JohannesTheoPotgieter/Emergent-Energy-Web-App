import type { Express } from 'express';
import { errorHandler } from '../middleware/errorHandler';

export function registerGlobalErrorHandler(app: Express): void {
  app.use(errorHandler);
}
