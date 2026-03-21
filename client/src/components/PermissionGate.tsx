import { ReactNode } from "react";
import { usePermission } from "@/hooks/use-permissions";
import { PermissionEntity, PermissionAction } from "@shared/schema";
import type { ProjectPermissions } from "@shared/api-types/project-v2";

/**
 * V2-permission-key mapping: maps entity:action pairs to V2 permission flags.
 * When serverPermissions prop is provided, these take priority over client-side evaluation.
 */
const V2_PERM_MAP: Record<string, keyof ProjectPermissions> = {
  "projects:view": "canView",
  "projects:edit": "canEdit",
  "projects:approve": "canApprove",
  "projects:delete": "canDelete",
  "admin:edit": "canManageTeam",
  "financials:override": "canOverrideFinance",
};

interface PermissionGateProps {
  entity: PermissionEntity;
  action: PermissionAction;
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional server-computed permissions from V2 API response */
  serverPermissions?: ProjectPermissions | null;
}

export function PermissionGate({ entity, action, children, fallback = null, serverPermissions }: PermissionGateProps) {
  const v2Key = V2_PERM_MAP[`${entity}:${action}`];

  // If V2 permissions are available and cover this entity:action, use them directly
  if (serverPermissions && v2Key) {
    return serverPermissions[v2Key] ? <>{children}</> : <>{fallback}</>;
  }

  // Fall back to existing client-side permission check
  return <PermissionGateFallback entity={entity} action={action} fallback={fallback}>{children}</PermissionGateFallback>;
}

/** Inner component that uses the hook (avoids calling hook conditionally) */
function PermissionGateFallback({ entity, action, children, fallback }: { entity: PermissionEntity; action: PermissionAction; children: ReactNode; fallback: ReactNode }) {
  const { allowed, loading } = usePermission(entity, action);

  if (loading) return null;
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
