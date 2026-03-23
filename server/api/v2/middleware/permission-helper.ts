/**
 * Prompt 14 — Permission Computation Helper
 *
 * Computes a ProjectPermissions object for the current user
 * based on existing permission-middleware.ts logic.
 */

import type { Request } from "express";
import { evaluatePermissionForRequest } from "../../../permission-middleware";
import type { ProjectPermissions } from "@shared/api-types/project-v2";

/**
 * Compute embedded permissions for the current request user
 * against the project-related permission entities.
 *
 * Returns a flat object suitable for embedding in API responses.
 */
export async function computeProjectPermissions(
  req: Request,
): Promise<ProjectPermissions> {
  const [
    viewResult,
    editResult,
    approveResult,
    deleteResult,
    manageTeamResult,
    overrideFinanceResult,
  ] = await Promise.all([
    evaluatePermissionForRequest(req, "projects", "view"),
    evaluatePermissionForRequest(req, "projects", "edit"),
    evaluatePermissionForRequest(req, "projects", "approve"),
    evaluatePermissionForRequest(req, "projects", "delete"),
    evaluatePermissionForRequest(req, "admin", "edit"),
    evaluatePermissionForRequest(req, "financials", "override"),
  ]);

  return {
    canView: viewResult.allowed,
    canEdit: editResult.allowed,
    canApprove: approveResult.allowed,
    canDelete: deleteResult.allowed,
    canManageTeam: manageTeamResult.allowed,
    canOverrideFinance: overrideFinanceResult.allowed,
  };
}
