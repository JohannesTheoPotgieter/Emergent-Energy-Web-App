/**
 * Lens Context — provides role-based UX lens state throughout the app.
 *
 * This builds on top of the existing auth/permission system. It does NOT
 * replace useAuth or useAccessMatrix — it adds a lens layer that determines
 * UX behavior (homepage, nav priority, quick actions, etc.)
 *
 * COO users can simulate other lenses via the lens switcher.
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import {
  resolveUserLens,
  isSuperAdmin,
  type LensRole,
  LENS_ROLE_LABELS,
  LENS_ROLES,
  CANONICAL_MODULES,
  DEFAULT_LENS_PROFILES,
  type LensProfileSeed,
} from "@shared/schema/role-based-upgrade";
import { normalizeRoleForPermissions } from "@shared/schema/users";

export interface LensSimulation {
  /** The lens being simulated */
  simulatedLens: LensRole;
  /** If simulating a specific user */
  simulatedUserId?: number;
  /** read_only = COO sees the view but retains their own permissions; full_power = acts as that role */
  mode: "read_only" | "full_power";
}

export interface LensContextValue {
  /** The user's natural lens (derived from their DB role) */
  naturalLens: LensRole;
  /** The currently active lens (natural or simulated) */
  activeLens: LensRole;
  /** Active lens label for display */
  activeLensLabel: string;
  /** Whether the user has super admin capabilities */
  isCooSuperAdmin: boolean;
  /** Current simulation state (null if not simulating) */
  simulation: LensSimulation | null;
  /** Start simulating another lens (COO only) */
  startSimulation: (lens: LensRole, mode?: "read_only" | "full_power", userId?: number) => void;
  /** Stop simulation and return to natural lens */
  stopSimulation: () => void;
  /** Get the lens profile for the active lens */
  getActiveLensProfile: () => LensProfileSeed;
  /** All available lens roles (for COO switcher) */
  availableLenses: readonly LensRole[];
  /** Get the effective DB role for permission checks */
  effectivePermissionRole: string;
}

const LensContext = createContext<LensContextValue | null>(null);

export function resolveEffectivePermissionRole(options: {
  dbRole?: string | null;
  simulation?: LensSimulation | null;
}) {
  const { dbRole, simulation } = options;
  if (simulation) {
    return normalizeRoleForPermissions(simulation.simulatedLens);
  }
  return normalizeRoleForPermissions(dbRole);
}

export function LensProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const dbRole = companyRole || user?.role || null;

  const naturalLens = useMemo(() => resolveUserLens(normalizeRoleForPermissions(dbRole)), [dbRole]);
  const cooSuperAdmin = useMemo(() => isSuperAdmin(normalizeRoleForPermissions(dbRole)), [dbRole]);

  const [simulation, setSimulation] = useState<LensSimulation | null>(null);
  const qc = useQueryClient();

  const startSimulation = useCallback((lens: LensRole, mode: "read_only" | "full_power" = "read_only", userId?: number) => {
    if (!cooSuperAdmin) return; // Only COO can simulate
    setSimulation({ simulatedLens: lens, mode, simulatedUserId: userId });
    // Invalidate permission queries so they refetch for the simulated role
    qc.invalidateQueries({ queryKey: ["auth-permissions"] });
    qc.invalidateQueries({ queryKey: ["auth-permissions-matrix"] });
  }, [cooSuperAdmin, qc]);

  const stopSimulation = useCallback(() => {
    setSimulation(null);
    // Invalidate permission queries to restore the natural role's permissions
    qc.invalidateQueries({ queryKey: ["auth-permissions"] });
    qc.invalidateQueries({ queryKey: ["auth-permissions-matrix"] });
  }, [qc]);

  const activeLens = simulation ? simulation.simulatedLens : naturalLens;
  const activeLensLabel = LENS_ROLE_LABELS[activeLens] || activeLens;

  const getActiveLensProfile = useCallback((): LensProfileSeed => {
    const profile = DEFAULT_LENS_PROFILES.find(p => p.lensRole === activeLens);
    return profile ?? DEFAULT_LENS_PROFILES.find(p => p.lensRole === 'ENGINEER')!;
  }, [activeLens]);

  // For permission checks: if simulating in full_power mode, use the simulated role's
  // permission equivalent. In read_only mode, keep the COO's own permissions.
  const effectivePermissionRole = useMemo(
    () => resolveEffectivePermissionRole({ dbRole, simulation }),
    [dbRole, simulation],
  );

  const value = useMemo<LensContextValue>(() => ({
    naturalLens,
    activeLens,
    activeLensLabel,
    isCooSuperAdmin: cooSuperAdmin,
    simulation,
    startSimulation,
    stopSimulation,
    getActiveLensProfile,
    availableLenses: LENS_ROLES,
    effectivePermissionRole,
  }), [naturalLens, activeLens, activeLensLabel, cooSuperAdmin, simulation, startSimulation, stopSimulation, getActiveLensProfile, effectivePermissionRole]);

  return (
    <LensContext.Provider value={value}>
      {children}
    </LensContext.Provider>
  );
}

export function useLensContext(): LensContextValue {
  const ctx = useContext(LensContext);
  if (!ctx) {
    throw new Error("useLensContext must be used within a LensProvider");
  }
  return ctx;
}

/**
 * Convenience hook: get the active lens profile's landing page.
 */
export function useLensLandingPage(): string {
  const { getActiveLensProfile } = useLensContext();
  return getActiveLensProfile().landingPage;
}

/**
 * Convenience hook: get the active lens profile's allowed modules.
 */
export function useLensModules() {
  const { getActiveLensProfile, isCooSuperAdmin, simulation } = useLensContext();
  const profile = getActiveLensProfile();
  // COO sees all modules only when NOT simulating
  if (isCooSuperAdmin && !simulation) {
    return [...CANONICAL_MODULES];
  }
  return profile.allowedModules;
}
