import { useAuth } from "./use-auth";
import { checkPermission, PermissionEntity, PermissionAction } from "@shared/schema";

export function usePermission(entity: PermissionEntity, action: PermissionAction): { allowed: boolean; loading: boolean } {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return { allowed: false, loading: true };
  }

  if (!user) {
    return { allowed: false, loading: false };
  }

  const allowed = checkPermission(user.role, entity, action);
  return { allowed, loading: false };
}
