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
  // Stage Lifecycle (Prompt 1 — gate-driven lifecycle)
  const { registerStageLifecycleRoutes } = await import("../stage-lifecycle-routes");
  registerStageLifecycleRoutes(app);
  // Stage Data + Charter (Prompt 3 — stage workspaces 1-5)
  const { registerStageDataRoutes } = await import("../stage-data-routes");
  registerStageDataRoutes(app);
  // Stage Collaboration (Prompt 7 — client commitments, updates, queries, access, financial close tracks)
  // Phase 1+2 cutover: canonical routes now serve all client-commitments and client-updates paths.
  // ADV-02/ADV-11 fix: collaboration-workflow-routes.ts is deprecated and has 14 unprotected
  // mutation endpoints. It was falsely documented as "never called" but WAS registered here.
  // Removed to eliminate permission bypass risk and route shadowing.
  // const { registerCollaborationWorkflowRoutes } = await import("../collaboration-workflow-routes");
  // registerCollaborationWorkflowRoutes(app);
  const { registerStageCollaborationRoutes } = await import("../stage-collaboration-routes");
  registerStageCollaborationRoutes(app);
}
