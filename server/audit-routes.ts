import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { changeSets, fieldChanges, auditEvents, OVERRIDE_CATEGORIES } from "@shared/schema";
import { eq, desc, and, sql, gte, lte, or, like, count } from "drizzle-orm";
import { verifyToken } from "./jwt";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      (req as any).user = {
        id: payload.userId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
      return next();
    }
  }
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role;
  if (role === "admin" || role === "COO_ADMIN" || role === "CEO_ADMIN") {
    return next();
  }
  res.status(403).json({ error: "Admin access required" });
}

export function registerAuditRoutes(app: Express) {
  // Project History Timeline - get all ChangeSets for a specific project
  app.get("/api/audit/project-history/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid projectId" });

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = (page - 1) * limit;
      const sourceFilter = req.query.source as string;

      const conditions = [eq(changeSets.projectId, projectId)];
      if (sourceFilter) {
        conditions.push(eq(changeSets.source, sourceFilter as any));
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      const [items, totalResult] = await Promise.all([
        db.select().from(changeSets)
          .where(whereClause)
          .orderBy(desc(changeSets.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(changeSets).where(whereClause),
      ]);

      const total = totalResult[0]?.total || 0;

      res.json({
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(Number(total) / limit) },
      });
    } catch (err: any) {
      console.error("[audit] project-history error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Project history by project name
  app.get("/api/audit/project-history-by-name/:projectName", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectName = decodeURIComponent(req.params.projectName as string);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = (page - 1) * limit;
      const sourceFilter = req.query.source as string;

      const conditions: any[] = [eq(changeSets.projectName, projectName)];
      if (sourceFilter) {
        conditions.push(eq(changeSets.source, sourceFilter as any));
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      const [items, totalResult] = await Promise.all([
        db.select().from(changeSets)
          .where(whereClause)
          .orderBy(desc(changeSets.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(changeSets).where(whereClause),
      ]);

      const total = totalResult[0]?.total || 0;

      res.json({
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(Number(total) / limit) },
      });
    } catch (err: any) {
      console.error("[audit] project-history-by-name error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get ChangeSet detail with field changes (drill-down)
  app.get("/api/audit/changeset/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [cs] = await db.select().from(changeSets).where(eq(changeSets.id, id));
      if (!cs) return res.status(404).json({ error: "ChangeSet not found" });

      const fields = await db.select().from(fieldChanges).where(eq(fieldChanges.changeSetId, id));

      res.json({ ...cs, fieldChanges: fields });
    } catch (err: any) {
      console.error("[audit] changeset detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/audit/activity-log", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = (page - 1) * limit;
      const sourceFilter = req.query.source as string;
      const entityTypeFilter = req.query.entityType as string;
      const projectNameFilter = req.query.projectName as string;
      const actionFilter = req.query.action as string;
      const fromDate = req.query.from as string;
      const toDate = req.query.to as string;
      const searchQuery = req.query.q as string;

      const userNameFilter = req.query.userName as string;

      const filterClauses: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (sourceFilter) { filterClauses.push(`source = $${paramIdx++}`); params.push(sourceFilter); }
      if (entityTypeFilter) { filterClauses.push(`entity_type = $${paramIdx++}`); params.push(entityTypeFilter); }
      if (projectNameFilter) { filterClauses.push(`project_name = $${paramIdx++}`); params.push(projectNameFilter); }
      if (actionFilter) { filterClauses.push(`action = $${paramIdx++}`); params.push(actionFilter); }
      if (userNameFilter) { filterClauses.push(`user_name = $${paramIdx++}`); params.push(userNameFilter); }
      if (fromDate) { filterClauses.push(`created_at >= $${paramIdx++}`); params.push(new Date(fromDate)); }
      if (toDate) { filterClauses.push(`created_at <= $${paramIdx++}`); params.push(new Date(toDate)); }
      if (searchQuery) {
        filterClauses.push(`(summary ILIKE $${paramIdx} OR action ILIKE $${paramIdx} OR entity_type ILIKE $${paramIdx} OR user_name ILIKE $${paramIdx} OR project_name ILIKE $${paramIdx})`);
        params.push(`%${searchQuery}%`);
        paramIdx++;
      }

      const whereStr = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';

      const unionQuery = `
        WITH unified AS (
          SELECT id, source::text as source, entity_type, entity_id, action, summary,
                 project_name, actor_role, actor_user_id as user_id, NULL::text as user_name,
                 created_at, 'changeset' as record_type, NULL::text as request_path, NULL::text as request_method,
                 NULL::jsonb as changes_json, NULL::text as ip_address
          FROM change_sets
          UNION ALL
          SELECT id, source::text as source, entity_type, entity_id, action,
                 COALESCE(
                   CASE
                     WHEN action = 'login_success' THEN 'User ' || COALESCE(user_name, 'unknown') || ' logged in (' || COALESCE(actor_role, '') || ')'
                     WHEN action = 'login_failed' THEN 'Failed login attempt for role ' || COALESCE(actor_role, 'unknown')
                     WHEN action = 'password_changed' THEN 'Password changed by ' || COALESCE(user_name, 'unknown')
                     ELSE COALESCE(user_name, 'System') || ' performed ' || action || ' on ' || entity_type
                   END
                 ) as summary,
                 project_name, actor_role, user_id, user_name,
                 created_at, 'audit_event' as record_type, request_path, request_method,
                 changes_json, ip_address
          FROM audit_events
        )
        SELECT * FROM unified ${whereStr}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countQuery = `
        WITH unified AS (
          SELECT source::text as source, entity_type, action, summary, project_name, created_at FROM change_sets
          UNION ALL
          SELECT source::text as source, entity_type, action,
                 COALESCE(user_name, 'System') || ' performed ' || action as summary,
                 project_name, created_at FROM audit_events
        )
        SELECT COUNT(*) as total FROM unified ${whereStr}
      `;

      const filtersQuery = `
        WITH unified AS (
          SELECT source::text as source, entity_type, action, project_name, NULL::text as user_name FROM change_sets
          UNION ALL
          SELECT source::text as source, entity_type, action, project_name, user_name FROM audit_events
        )
        SELECT
          ARRAY(SELECT DISTINCT source FROM unified WHERE source IS NOT NULL) as sources,
          ARRAY(SELECT DISTINCT entity_type FROM unified WHERE entity_type IS NOT NULL ORDER BY entity_type LIMIT 100) as entity_types,
          ARRAY(SELECT DISTINCT action FROM unified WHERE action IS NOT NULL ORDER BY action LIMIT 100) as actions,
          ARRAY(SELECT DISTINCT project_name FROM unified WHERE project_name IS NOT NULL ORDER BY project_name LIMIT 100) as project_names,
          ARRAY(SELECT DISTINCT user_name FROM unified WHERE user_name IS NOT NULL ORDER BY user_name LIMIT 100) as user_names
      `;

      const [itemsResult, countResult, filtersResult] = await Promise.all([
        db.execute(sql.raw(unionQuery.replace(/\$(\d+)/g, (_, n) => {
          const val = params[parseInt(n) - 1];
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          return String(val);
        }))),
        db.execute(sql.raw(countQuery.replace(/\$(\d+)/g, (_, n) => {
          const val = params[parseInt(n) - 1];
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          return String(val);
        }))),
        db.execute(sql.raw(filtersQuery)),
      ]);

      const items = (itemsResult as any).rows || itemsResult;
      const total = Number((countResult as any).rows?.[0]?.total || (countResult as any)[0]?.total || 0);
      const filterData = (filtersResult as any).rows?.[0] || (filtersResult as any)[0] || {};

      res.json({
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        filters: {
          sources: filterData.sources || [],
          entityTypes: filterData.entity_types || [],
          actions: filterData.actions || [],
          projectNames: (filterData.project_names || []).filter(Boolean),
          userNames: (filterData.user_names || []).filter(Boolean),
        },
      });
    } catch (err: any) {
      console.error("[audit] activity-log error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/audit/activity-log/export", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const sourceFilter = req.query.source as string;
      const entityTypeFilter = req.query.entityType as string;
      const projectNameFilter = req.query.projectName as string;
      const actionFilter = req.query.action as string;
      const userNameFilter = req.query.userName as string;
      const fromDate = req.query.from as string;
      const toDate = req.query.to as string;
      const searchQuery = req.query.q as string;

      const filterClauses: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (sourceFilter) { filterClauses.push(`source = $${paramIdx++}`); params.push(sourceFilter); }
      if (entityTypeFilter) { filterClauses.push(`entity_type = $${paramIdx++}`); params.push(entityTypeFilter); }
      if (projectNameFilter) { filterClauses.push(`project_name = $${paramIdx++}`); params.push(projectNameFilter); }
      if (actionFilter) { filterClauses.push(`action = $${paramIdx++}`); params.push(actionFilter); }
      if (userNameFilter) { filterClauses.push(`user_name = $${paramIdx++}`); params.push(userNameFilter); }
      if (fromDate) { filterClauses.push(`created_at >= $${paramIdx++}`); params.push(new Date(fromDate)); }
      if (toDate) { filterClauses.push(`created_at <= $${paramIdx++}`); params.push(new Date(toDate)); }
      if (searchQuery) {
        filterClauses.push(`(summary ILIKE $${paramIdx} OR action ILIKE $${paramIdx} OR entity_type ILIKE $${paramIdx} OR user_name ILIKE $${paramIdx} OR project_name ILIKE $${paramIdx})`);
        params.push(`%${searchQuery}%`);
        paramIdx++;
      }

      const whereStr = filterClauses.length > 0 ? `WHERE ${filterClauses.join(' AND ')}` : '';

      const exportQuery = `
        WITH unified AS (
          SELECT id, source::text as source, entity_type, entity_id, action, summary,
                 project_name, actor_role, actor_user_id as user_id, NULL::text as user_name,
                 created_at, 'changeset' as record_type
          FROM change_sets
          UNION ALL
          SELECT id, source::text as source, entity_type, entity_id, action,
                 COALESCE(
                   CASE
                     WHEN action = 'login_success' THEN 'User ' || COALESCE(user_name, 'unknown') || ' logged in'
                     WHEN action = 'login_failed' THEN 'Failed login attempt for role ' || COALESCE(actor_role, 'unknown')
                     WHEN action = 'password_changed' THEN 'Password changed by ' || COALESCE(user_name, 'unknown')
                     ELSE COALESCE(user_name, 'System') || ' performed ' || action || ' on ' || entity_type
                   END
                 ) as summary,
                 project_name, actor_role, user_id, user_name,
                 created_at, 'audit_event' as record_type
          FROM audit_events
        )
        SELECT * FROM unified ${whereStr}
        ORDER BY created_at DESC
        LIMIT 10000
      `;

      const result = await db.execute(sql.raw(exportQuery.replace(/\$(\d+)/g, (_, n) => {
        const val = params[parseInt(n) - 1];
        if (val instanceof Date) return `'${val.toISOString()}'`;
        if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
        return String(val);
      })));

      const rows = (result as any).rows || result;

      const csvHeaders = ['Time', 'Source', 'Action', 'Entity Type', 'Entity ID', 'Project', 'User', 'Role', 'Summary', 'Record Type'];
      const csvRows = rows.map((r: any) => [
        r.created_at ? new Date(r.created_at).toISOString() : '',
        r.source || '',
        r.action || '',
        r.entity_type || '',
        r.entity_id || '',
        r.project_name || '',
        r.user_name || '',
        r.actor_role || '',
        (r.summary || '').replace(/"/g, '""'),
        r.record_type || '',
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map((row: string[]) => row.map(v => `"${v}"`).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csvContent);
    } catch (err: any) {
      console.error("[audit] activity-log export error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Override categories reference endpoint
  app.get("/api/audit/override-categories", requireAuth, (_req: Request, res: Response) => {
    res.json({ categories: OVERRIDE_CATEGORIES });
  });
}
