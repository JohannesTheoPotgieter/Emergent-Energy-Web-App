/**
 * Re-export shared priority constants for client usage.
 * Single source of truth lives in shared/config/priorities.ts
 */
export {
  PRIORITY_ADMIN_ROLES,
  DEPARTMENT_HEAD_ROLES,
  PRIORITY_SCOPES,
  ESCALATION_REASONS,
  SCOPE_LABELS,
  DEPARTMENT_OPTIONS,
  PRIORITY_TERMINAL_STATUSES,
  canPriorityRoleEditPriority,
  canPriorityRoleEscalatePriority,
  canPriorityRoleReadPriority,
  canPriorityRoleCreateScope,
  canPriorityRoleUseAdminAction,
  departmentLabel,
  isPriorityTerminalStatus,
  isPriorityAdminRole,
  isDepartmentHeadRole,
} from "@shared/config/priorities";
export type {
  PriorityAdminRole,
  DepartmentHeadRole,
  PriorityScope,
  EscalationReason,
  DepartmentOption,
  PriorityTerminalStatus,
  PriorityAccessUser,
  PriorityMutabilityRow,
} from "@shared/config/priorities";
