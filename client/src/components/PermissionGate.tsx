import { ReactNode } from "react";
import { usePermission } from "@/hooks/use-permissions";
import { PermissionEntity, PermissionAction } from "@shared/schema";

interface PermissionGateProps {
  entity: PermissionEntity;
  action: PermissionAction;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({ entity, action, children, fallback = null }: PermissionGateProps) {
  const { allowed, loading } = usePermission(entity, action);

  if (loading) {
    return null;
  }

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
