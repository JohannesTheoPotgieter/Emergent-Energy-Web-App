import type { Express } from "express";

export async function registerProjectRoutes(app: Express) {
  const { registerPmRoutes } = await import("../pm-routes");
  registerPmRoutes(app);
  const { registerPmOnTheGoRoutes } = await import("../pm-on-the-go-routes");
  registerPmOnTheGoRoutes(app);
  const { registerPoRoutes } = await import("../po-routes");
  registerPoRoutes(app);
  const { registerDeliverableCaptureRoutes } = await import("../deliverable-capture-routes");
  registerDeliverableCaptureRoutes(app);
  const { registerPortfolioRoutes } = await import("../portfolio-routes");
  registerPortfolioRoutes(app);
  const { registerPdRoutes } = await import("../pd-routes");
  registerPdRoutes(app);
  const { registerProjectEventsRoutes } = await import("../project-events-routes");
  registerProjectEventsRoutes(app);
  // EPC Workflow Phase 1
  const { registerPaymentRequestRoutes } = await import("../payment-request-routes");
  registerPaymentRequestRoutes(app);
  const { registerPaymentBatchRoutes } = await import("../payment-batch-routes");
  registerPaymentBatchRoutes(app);
  const { registerProofOfPaymentRoutes } = await import("../proof-of-payment-routes");
  registerProofOfPaymentRoutes(app);
  // Financial Review Gate
  const { registerFinancialReviewRoutes } = await import("../financial-review-routes");
  registerFinancialReviewRoutes(app);
}
