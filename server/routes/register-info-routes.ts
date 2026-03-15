import type { Express } from "express";

export async function registerInfoRoutes(app: Express) {
  const { registerEeInfoRoutes } = await import("../ee-info-routes");
  registerEeInfoRoutes(app);
  const { registerWeeklyReviewRoutes } = await import("../weekly-review-routes");
  registerWeeklyReviewRoutes(app);
  const { registerTrRegisterRoutes } = await import("../tr-register-routes");
  registerTrRegisterRoutes(app);
}
