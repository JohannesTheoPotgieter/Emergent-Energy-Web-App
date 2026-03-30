/**
 * Lens Configuration API Routes
 *
 * Provides endpoints for:
 * - Getting lens profile for a role
 * - Getting all lens profiles (for COO switcher)
 * - Starting/stopping lens simulations
 * - Getting role homepage widget configs
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import {
  roleLensProfiles,
  roleHomepageWidgets,
  lensSimulationSessions,
  contracts,
  ssegApplications,
  DEFAULT_LENS_PROFILES,
  ROLE_TO_LENS_MAP,
  LENS_ROLE_LABELS,
  LENS_ROLES,
  resolveUserLens,
  isSuperAdmin,
  type LensRole,
} from "@shared/schema/role-based-upgrade";
import { normalizeRoleForPermissions } from "@shared/schema/users";

export function registerLensConfigRoutes(app: Express) {
  /**
   * GET /api/lens/profile
   * Returns the active lens profile for the requesting user.
   */
  app.get("/api/lens/profile", async (req: Request, res: Response) => {
    try {
      const companyRole = req.headers["x-company-role"] as string | undefined;
      const userRole = (req as any).user?.role;
      const effectiveRole = normalizeRoleForPermissions(companyRole || userRole);
      const lens = resolveUserLens(effectiveRole);

      // Try DB first
      const dbProfile = await db.select().from(roleLensProfiles).where(eq(roleLensProfiles.lensRole, lens)).limit(1);
      if (dbProfile.length > 0) {
        return res.json({ profile: dbProfile[0], source: "database" });
      }

      // Fall back to hardcoded defaults
      const defaultProfile = DEFAULT_LENS_PROFILES.find(p => p.lensRole === lens);
      return res.json({ profile: defaultProfile ?? DEFAULT_LENS_PROFILES[0], source: "default" });
    } catch (err) {
      console.error("[LensConfig] Error fetching profile:", err);
      return res.status(500).json({ error: "Failed to fetch lens profile" });
    }
  });

  /**
   * GET /api/lens/profiles
   * Returns all available lens profiles (for COO lens switcher).
   */
  app.get("/api/lens/profiles", async (_req: Request, res: Response) => {
    try {
      // Try DB first
      const dbProfiles = await db.select().from(roleLensProfiles);
      if (dbProfiles.length > 0) {
        return res.json({ profiles: dbProfiles, source: "database" });
      }

      // Fall back to defaults
      return res.json({ profiles: DEFAULT_LENS_PROFILES, source: "default" });
    } catch (err) {
      console.error("[LensConfig] Error fetching profiles:", err);
      return res.status(500).json({ error: "Failed to fetch lens profiles" });
    }
  });

  /**
   * GET /api/lens/roles
   * Returns the lens role mapping and all available lens roles.
   */
  app.get("/api/lens/roles", (_req: Request, res: Response) => {
    res.json({
      lensRoles: LENS_ROLES,
      labels: LENS_ROLE_LABELS,
      roleToLensMap: ROLE_TO_LENS_MAP,
    });
  });

  /**
   * POST /api/lens/simulate
   * Start a lens simulation session (COO only).
   */
  app.post("/api/lens/simulate", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const userRole = (req as any).user?.role;
      const companyRole = req.headers["x-company-role"] as string | undefined;
      const effectiveRole = normalizeRoleForPermissions(companyRole || userRole);

      if (!isSuperAdmin(effectiveRole)) {
        return res.status(403).json({ error: "Only COO super admin can simulate lenses" });
      }

      const { lensRole, mode = "read_only", simulatedUserId } = req.body;
      if (!lensRole || !LENS_ROLES.includes(lensRole)) {
        return res.status(400).json({ error: "Invalid lens role" });
      }

      // End any active simulation for this user
      if (userId) {
        await db.update(lensSimulationSessions)
          .set({ isActive: false, endedAt: new Date() })
          .where(and(
            eq(lensSimulationSessions.userId, userId),
            eq(lensSimulationSessions.isActive, true),
          ));

        // Create new simulation session
        await db.insert(lensSimulationSessions).values({
          userId,
          simulatedLensRole: lensRole,
          simulatedUserId: simulatedUserId || null,
          mode,
          isActive: true,
        });
      }

      return res.json({ success: true, activeLens: lensRole, mode });
    } catch (err) {
      console.error("[LensConfig] Error starting simulation:", err);
      return res.status(500).json({ error: "Failed to start simulation" });
    }
  });

  /**
   * POST /api/lens/simulate/stop
   * Stop the current lens simulation.
   */
  app.post("/api/lens/simulate/stop", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (userId) {
        await db.update(lensSimulationSessions)
          .set({ isActive: false, endedAt: new Date() })
          .where(and(
            eq(lensSimulationSessions.userId, userId),
            eq(lensSimulationSessions.isActive, true),
          ));
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[LensConfig] Error stopping simulation:", err);
      return res.status(500).json({ error: "Failed to stop simulation" });
    }
  });

  /**
   * GET /api/lens/widgets/:lensRole
   * Returns homepage widget configurations for a lens role.
   */
  app.get("/api/lens/widgets/:lensRole", async (req: Request, res: Response) => {
    try {
      const { lensRole } = req.params;
      const widgets = await db.select()
        .from(roleHomepageWidgets)
        .where(and(
          eq(roleHomepageWidgets.lensRole, lensRole),
          eq(roleHomepageWidgets.isVisible, true),
        ))
        .orderBy(roleHomepageWidgets.position);

      return res.json({ widgets, lensRole });
    } catch (err) {
      console.error("[LensConfig] Error fetching widgets:", err);
      return res.status(500).json({ error: "Failed to fetch widgets" });
    }
  });

  /**
   * GET /api/contracts
   * Returns contracts, optionally filtered by projectId.
   */
  app.get("/api/contracts", async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      let query = db.select().from(contracts).where(isNull(contracts.deletedAt));
      if (projectId) {
        const results = await db.select().from(contracts).where(
          and(eq(contracts.projectId, projectId), isNull(contracts.deletedAt))
        );
        return res.json({ contracts: results });
      }
      const results = await query;
      return res.json({ contracts: results });
    } catch (err) {
      console.error("[Contracts] Error:", err);
      return res.status(500).json({ error: "Failed to fetch contracts" });
    }
  });

  /**
   * GET /api/sseg-applications
   * Returns SSEG applications, optionally filtered by projectId.
   */
  app.get("/api/sseg-applications", async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      if (projectId) {
        const results = await db.select().from(ssegApplications).where(
          and(eq(ssegApplications.projectId, projectId), isNull(ssegApplications.deletedAt))
        );
        return res.json({ applications: results });
      }
      const results = await db.select().from(ssegApplications).where(isNull(ssegApplications.deletedAt));
      return res.json({ applications: results });
    } catch (err) {
      console.error("[SSEG] Error:", err);
      return res.status(500).json({ error: "Failed to fetch SSEG applications" });
    }
  });
}
