import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, asc, sql, inArray, isNull, count, ilike, or } from "drizzle-orm";
import {
  workItems, workItemAssignments, workItemStatusHistory,
  workItemComments, workItemAttachments,
  taskTags, workItemTags, taskTimeEntries,
  users, projectInfo,
  type InsertWorkItem, type InsertTaskTag,
} from "@shared/schema";
import { getEffectiveUser, requireAuth } from "./auth-context";

type AppUser = { id: number; email: string; name: string; role: string };

function getUser(req: Request): AppUser {
  return getEffectiveUser(req) as AppUser;
}

export function registerTaskManagementRoutes(app: Express) {

  // ── Unified Task Hub ───────────────────────────────────────────────────────

  /** List tasks with comprehensive filters */
  app.get("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        projectId, status, priority, assigneeId, workstream,
        taskCategory, tagId, search,
        limit: limitStr, offset: offsetStr,
        sortBy, sortDir,
      } = req.query;

      const limit = parseInt(limitStr as string) || 50;
      const offset = parseInt(offsetStr as string) || 0;

      const conditions = [isNull(workItems.deletedAt)];

      if (projectId) conditions.push(eq(workItems.projectId, parseInt(projectId as string)));
      if (status) conditions.push(eq(workItems.status, status as string));
      if (priority) conditions.push(eq(workItems.priority, priority as string));
      if (workstream) conditions.push(eq(workItems.workstream, workstream as string));
      if (taskCategory) conditions.push(eq(workItems.taskCategory, taskCategory as string));
      if (assigneeId) conditions.push(eq(workItems.ownerUserId, parseInt(assigneeId as string)));
      if (search) {
        conditions.push(or(
          ilike(workItems.title, `%${search}%`),
          ilike(workItems.description, `%${search}%`)
        )!);
      }

      // Build sort
      const sortColumn = sortBy === "priority" ? workItems.priority
        : sortBy === "startDate" ? workItems.startDate
        : sortBy === "endDate" ? workItems.endDate
        : sortBy === "status" ? workItems.status
        : workItems.updatedAt;
      const sortOrder = sortDir === "asc" ? asc(sortColumn) : desc(sortColumn);

      const items = await db
        .select({
          id: workItems.id,
          projectId: workItems.projectId,
          workstream: workItems.workstream,
          title: workItems.title,
          description: workItems.description,
          status: workItems.status,
          priority: workItems.priority,
          startDate: workItems.startDate,
          endDate: workItems.endDate,
          percentComplete: workItems.percentComplete,
          ownerUserId: workItems.ownerUserId,
          ownerName: workItems.ownerName,
          estimateMinutes: workItems.estimateMinutes,
          taskCategory: workItems.taskCategory,
          isMilestone: workItems.isMilestone,
          phase: workItems.phase,
          scheduledDate: workItems.scheduledDate,
          createdAt: workItems.createdAt,
          updatedAt: workItems.updatedAt,
        })
        .from(workItems)
        .where(and(...conditions))
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset);

      // Get total count
      const [totalResult] = await db
        .select({ count: count() })
        .from(workItems)
        .where(and(...conditions));

      // Enrich with tags for the returned items
      const itemIds = items.map((i) => i.id);
      let tagsByItem: Record<number, { id: number; name: string; color: string; category: string }[]> = {};

      if (itemIds.length > 0) {
        const tagRows = await db
          .select({
            workItemId: workItemTags.workItemId,
            tagId: taskTags.id,
            tagName: taskTags.name,
            tagColor: taskTags.color,
            tagCategory: taskTags.category,
          })
          .from(workItemTags)
          .innerJoin(taskTags, eq(workItemTags.tagId, taskTags.id))
          .where(inArray(workItemTags.workItemId, itemIds));

        for (const row of tagRows) {
          if (!tagsByItem[row.workItemId]) tagsByItem[row.workItemId] = [];
          tagsByItem[row.workItemId].push({
            id: row.tagId,
            name: row.tagName,
            color: row.tagColor,
            category: row.tagCategory,
          });
        }
      }

      // Filter by tag if specified (post-filter since it's a join)
      let filteredItems = items;
      if (tagId) {
        const tagIdNum = parseInt(tagId as string);
        const itemsWithTag = new Set(
          Object.entries(tagsByItem)
            .filter(([, tags]) => tags.some((t) => t.id === tagIdNum))
            .map(([id]) => parseInt(id))
        );
        filteredItems = items.filter((i) => itemsWithTag.has(i.id));
      }

      res.json({
        items: filteredItems.map((item) => ({
          ...item,
          tags: tagsByItem[item.id] || [],
        })),
        total: totalResult.count,
        limit,
        offset,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Board view — tasks grouped by status */
  app.get("/api/tasks/board", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId, assigneeId, workstream } = req.query;
      const conditions = [isNull(workItems.deletedAt)];

      if (projectId) conditions.push(eq(workItems.projectId, parseInt(projectId as string)));
      if (assigneeId) conditions.push(eq(workItems.ownerUserId, parseInt(assigneeId as string)));
      if (workstream) conditions.push(eq(workItems.workstream, workstream as string));

      const items = await db
        .select({
          id: workItems.id,
          projectId: workItems.projectId,
          title: workItems.title,
          status: workItems.status,
          priority: workItems.priority,
          ownerUserId: workItems.ownerUserId,
          ownerName: workItems.ownerName,
          endDate: workItems.endDate,
          percentComplete: workItems.percentComplete,
          taskCategory: workItems.taskCategory,
          estimateMinutes: workItems.estimateMinutes,
          sortOrder: workItems.sortOrder,
        })
        .from(workItems)
        .where(and(...conditions))
        .orderBy(asc(workItems.sortOrder), desc(workItems.updatedAt));

      // Group by status
      const columns: Record<string, typeof items> = {
        "Not Started": [],
        "In Progress": [],
        "Complete": [],
        "Delayed": [],
      };

      for (const item of items) {
        const status = item.status || "Not Started";
        if (!columns[status]) columns[status] = [];
        columns[status].push(item);
      }

      res.json(columns);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Calendar view — tasks bucketed by date */
  app.get("/api/tasks/calendar", requireAuth, async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, projectId, assigneeId } = req.query;
      const conditions = [isNull(workItems.deletedAt)];

      if (projectId) conditions.push(eq(workItems.projectId, parseInt(projectId as string)));
      if (assigneeId) conditions.push(eq(workItems.ownerUserId, parseInt(assigneeId as string)));

      // Filter to items that have dates within the range
      if (startDate && endDate) {
        conditions.push(sql`(${workItems.endDate} >= ${startDate} OR ${workItems.scheduledDate} >= ${startDate})`);
        conditions.push(sql`(${workItems.startDate} <= ${endDate} OR ${workItems.scheduledDate} <= ${endDate})`);
      }

      const items = await db
        .select({
          id: workItems.id,
          title: workItems.title,
          status: workItems.status,
          priority: workItems.priority,
          startDate: workItems.startDate,
          endDate: workItems.endDate,
          scheduledDate: workItems.scheduledDate,
          ownerName: workItems.ownerName,
          taskCategory: workItems.taskCategory,
          percentComplete: workItems.percentComplete,
        })
        .from(workItems)
        .where(and(...conditions))
        .orderBy(asc(workItems.startDate));

      // Bucket by date
      const calendar: Record<string, typeof items> = {};
      for (const item of items) {
        const date = item.scheduledDate || item.endDate || item.startDate;
        if (date) {
          if (!calendar[date]) calendar[date] = [];
          calendar[date].push(item);
        }
      }

      res.json(calendar);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Task metrics — velocity, completion rate, tag breakdown */
  app.get("/api/tasks/metrics", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId, days } = req.query;
      const lookbackDays = parseInt(days as string) || 30;
      const conditions = [isNull(workItems.deletedAt)];

      if (projectId) conditions.push(eq(workItems.projectId, parseInt(projectId as string)));

      // Status breakdown
      const statusBreakdown = await db
        .select({
          status: workItems.status,
          count: count(),
        })
        .from(workItems)
        .where(and(...conditions))
        .groupBy(workItems.status);

      // Priority breakdown
      const priorityBreakdown = await db
        .select({
          priority: workItems.priority,
          count: count(),
        })
        .from(workItems)
        .where(and(...conditions))
        .groupBy(workItems.priority);

      // Category breakdown
      const categoryBreakdown = await db
        .select({
          category: workItems.taskCategory,
          count: count(),
        })
        .from(workItems)
        .where(and(...conditions, sql`${workItems.taskCategory} IS NOT NULL`))
        .groupBy(workItems.taskCategory);

      // Completion velocity (items completed in the last N days)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
      const [velocity] = await db
        .select({ count: count() })
        .from(workItemStatusHistory)
        .innerJoin(workItems, eq(workItemStatusHistory.workItemId, workItems.id))
        .where(and(
          eq(workItemStatusHistory.newStatus, "Complete"),
          sql`${workItemStatusHistory.changedAt} >= ${cutoffDate}`,
          ...(projectId ? [eq(workItems.projectId, parseInt(projectId as string))] : [])
        ));

      // Time logged in period
      const timeConditions = [sql`${taskTimeEntries.createdAt} >= ${cutoffDate}`];
      const [timeLogged] = await db
        .select({ total: sql<number>`COALESCE(SUM(${taskTimeEntries.durationMinutes}), 0)` })
        .from(taskTimeEntries)
        .where(and(...timeConditions));

      // Workstream breakdown
      const workstreamBreakdown = await db
        .select({
          workstream: workItems.workstream,
          count: count(),
        })
        .from(workItems)
        .where(and(...conditions))
        .groupBy(workItems.workstream);

      res.json({
        statusBreakdown,
        priorityBreakdown,
        categoryBreakdown,
        workstreamBreakdown,
        completionVelocity: velocity.count,
        totalTimeLoggedMinutes: timeLogged.total,
        lookbackDays,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a task */
  app.post("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const {
        projectId, workstream, title, description, status, priority,
        startDate, endDate, estimateMinutes, taskCategory,
        assigneeUserId, tagIds,
      } = req.body;

      if (!projectId || !title) {
        return res.status(400).json({ error: "projectId and title are required" });
      }

      const [item] = await db.insert(workItems).values({
        projectId,
        workstream: workstream || "ENG",
        title,
        description: description || null,
        status: status || "Not Started",
        priority: priority || null,
        startDate: startDate || null,
        endDate: endDate || null,
        estimateMinutes: estimateMinutes || null,
        taskCategory: taskCategory || null,
        source: "UI",
        createdBy: user.id,
        ownerUserId: assigneeUserId || user.id,
      } as any).returning();

      // Assign tags
      if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
        await db.insert(workItemTags).values(
          tagIds.map((tagId: number) => ({
            workItemId: item.id,
            tagId,
          }))
        );
      }

      // Record status history
      await db.insert(workItemStatusHistory).values({
        workItemId: item.id,
        newStatus: item.status,
        changedBy: user.id,
        reason: "Task created",
      });

      res.status(201).json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Update a task */
  app.patch("/api/tasks/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = getUser(req);
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return next();
      }
      const body = req.body;

      // Get current item for status change tracking
      const [current] = await db
        .select()
        .from(workItems)
        .where(eq(workItems.id, id));

      if (!current) return res.status(404).json({ error: "Task not found" });

      const updates: Record<string, any> = { updatedAt: new Date() };
      const allowed = [
        "title", "description", "status", "priority", "startDate", "endDate",
        "percentComplete", "estimateMinutes", "taskCategory", "ownerUserId",
        "ownerName", "scheduledDate", "sortOrder", "workstream", "phase",
      ];
      for (const key of allowed) {
        if (body[key] !== undefined) updates[key] = body[key];
      }

      const [updated] = await db
        .update(workItems)
        .set(updates)
        .where(eq(workItems.id, id))
        .returning();

      // Record status change
      if (body.status && body.status !== current.status) {
        await db.insert(workItemStatusHistory).values({
          workItemId: id,
          oldStatus: current.status,
          newStatus: body.status,
          changedBy: user.id,
          reason: body.statusReason || null,
        });
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Soft-delete a task */
  app.delete("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid task ID" });
      }
      await db
        .update(workItems)
        .set({ deletedAt: new Date() })
        .where(eq(workItems.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Bulk update tasks (status or assignment) */
  app.post("/api/tasks/bulk-update", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { taskIds, updates } = req.body;

      if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
        return res.status(400).json({ error: "taskIds array is required" });
      }

      const allowed: Record<string, any> = { updatedAt: new Date() };
      if (updates.status) allowed.status = updates.status;
      if (updates.priority) allowed.priority = updates.priority;
      if (updates.ownerUserId) allowed.ownerUserId = updates.ownerUserId;

      await db
        .update(workItems)
        .set(allowed)
        .where(inArray(workItems.id, taskIds));

      // Record status changes
      if (updates.status) {
        for (const taskId of taskIds) {
          await db.insert(workItemStatusHistory).values({
            workItemId: taskId,
            newStatus: updates.status,
            changedBy: user.id,
            reason: "Bulk update",
          });
        }
      }

      res.json({ success: true, updatedCount: taskIds.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Time Tracking ──────────────────────────────────────────────────────────

  /** Log time for a task */
  app.post("/api/tasks/:id/time", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const workItemId = parseInt(req.params.id);
      const { durationMinutes, description, date } = req.body;

      if (!durationMinutes || durationMinutes <= 0) {
        return res.status(400).json({ error: "durationMinutes must be positive" });
      }

      const [entry] = await db.insert(taskTimeEntries).values({
        workItemId,
        userId: user.id,
        durationMinutes,
        description: description || null,
        date: date || new Date().toISOString().split("T")[0],
      }).returning();

      res.status(201).json(entry);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Get time entries for a task */
  app.get("/api/tasks/:id/time", requireAuth, async (req: Request, res: Response) => {
    try {
      const workItemId = parseInt(req.params.id);
      const entries = await db
        .select({
          id: taskTimeEntries.id,
          workItemId: taskTimeEntries.workItemId,
          userId: taskTimeEntries.userId,
          durationMinutes: taskTimeEntries.durationMinutes,
          description: taskTimeEntries.description,
          date: taskTimeEntries.date,
          createdAt: taskTimeEntries.createdAt,
          userName: users.name,
        })
        .from(taskTimeEntries)
        .leftJoin(users, eq(taskTimeEntries.userId, users.id))
        .where(eq(taskTimeEntries.workItemId, workItemId))
        .orderBy(desc(taskTimeEntries.date));

      const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);

      res.json({ entries, totalMinutes });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tags ───────────────────────────────────────────────────────────────────

  /** List all tags */
  app.get("/api/tags", requireAuth, async (_req: Request, res: Response) => {
    try {
      const tags = await db
        .select()
        .from(taskTags)
        .orderBy(asc(taskTags.category), asc(taskTags.name));
      res.json(tags);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a tag */
  app.post("/api/tags", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const { name, color, category } = req.body;

      if (!name) return res.status(400).json({ error: "name is required" });

      const [tag] = await db.insert(taskTags).values({
        name,
        color: color || "#6366f1",
        category: category || "CUSTOM",
        createdBy: user.id,
      }).returning();

      res.status(201).json(tag);
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        return res.status(409).json({ error: "Tag name already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  /** Update a tag */
  app.patch("/api/tags/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { name, color, category } = req.body;

      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (color !== undefined) updates.color = color;
      if (category !== undefined) updates.category = category;

      const [updated] = await db
        .update(taskTags)
        .set(updates)
        .where(eq(taskTags.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete a tag */
  app.delete("/api/tags/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(taskTags).where(eq(taskTags.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Assign tags to a task */
  app.post("/api/tasks/:id/tags", requireAuth, async (req: Request, res: Response) => {
    try {
      const workItemId = parseInt(req.params.id);
      const { tagIds } = req.body;

      if (!tagIds || !Array.isArray(tagIds)) {
        return res.status(400).json({ error: "tagIds array is required" });
      }

      // Insert new tags (ignore conflicts)
      for (const tagId of tagIds) {
        await db.insert(workItemTags).values({
          workItemId,
          tagId,
        }).onConflictDoNothing();
      }

      // Return current tags
      const currentTags = await db
        .select({
          tagId: taskTags.id,
          name: taskTags.name,
          color: taskTags.color,
          category: taskTags.category,
        })
        .from(workItemTags)
        .innerJoin(taskTags, eq(workItemTags.tagId, taskTags.id))
        .where(eq(workItemTags.workItemId, workItemId));

      res.json(currentTags);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Remove a tag from a task */
  app.delete("/api/tasks/:id/tags/:tagId", requireAuth, async (req: Request, res: Response) => {
    try {
      const workItemId = parseInt(req.params.id);
      const tagId = parseInt(req.params.tagId);

      await db.delete(workItemTags).where(
        and(
          eq(workItemTags.workItemId, workItemId),
          eq(workItemTags.tagId, tagId)
        )
      );

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Seed Data ──────────────────────────────────────────────────────────────

  /** Seed identified bugs/improvements/features as work items */
  app.post("/api/tasks/seed-identified-items", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = getUser(req);

      // Check if already seeded
      const existing = await db
        .select({ count: count() })
        .from(workItems)
        .where(and(
          eq(workItems.taskCategory, "BUG"),
          ilike(workItems.title, "%[CODE-ANALYSIS]%")
        ));

      if (existing[0].count > 0) {
        return res.json({ message: "Items already seeded", seeded: false });
      }

      // Get or create a project for internal tracking
      const [project] = await db
        .select()
        .from(projectInfo)
        .limit(1);

      if (!project) {
        return res.status(400).json({ error: "No project found to associate items with" });
      }

      const bugs = [
        { title: "[CODE-ANALYSIS] Critical: Hardcoded access code in login.tsx", priority: "Critical", description: "Hardcoded access code '2024' is visible in client-side login.tsx:317. This is a security vulnerability — access codes should be validated server-side only." },
        { title: "[CODE-ANALYSIS] Critical: Auth tokens stored in plain localStorage", priority: "Critical", description: "Auth tokens stored in localStorage are vulnerable to XSS attacks. Affected files: client/src/lib/api.ts, hooks/use-auth.tsx. Consider httpOnly cookies." },
        { title: "[CODE-ANALYSIS] High: Race condition in file upload", priority: "High", description: "smart-import.tsx:164-194 mutates state array in a loop during file upload, causing potential race conditions and lost updates." },
        { title: "[CODE-ANALYSIS] High: Unsafe 'as any' type casts", priority: "High", description: "Multiple unsafe 'as any' casts in TaskDetailDrawer.tsx, EditableDataGrid.tsx, CaptureDeliverable.tsx bypass TypeScript safety and hide potential runtime errors." },
        { title: "[CODE-ANALYSIS] Medium: Inconsistent role guard logic", priority: "Medium", description: "App.tsx:235-261 mixes effectiveRole vs user?.role for route guards. This inconsistency could allow unauthorized access to protected routes." },
        { title: "[CODE-ANALYSIS] Medium: Permission checks before data loads", priority: "Medium", description: "App.tsx:221-233 runs permission checks before permissions data has loaded, potentially showing flash of unauthorized content or incorrect redirects." },
        { title: "[CODE-ANALYSIS] Medium: No request timeouts for file uploads", priority: "Medium", description: "smart-import.tsx:155-214 file uploads have no timeout, potentially leaving the UI in a loading state indefinitely on network issues." },
        { title: "[CODE-ANALYSIS] Low: Missing clearTimeout cleanup in useEffect", priority: "Low", description: "UserAssignmentPicker.tsx:125-129 sets a setTimeout in useEffect without clearing it on cleanup, causing potential memory leaks on rapid re-renders." },
        { title: "[CODE-ANALYSIS] Low: Debug data on window object", priority: "Low", description: "App.tsx:217-219,276-285 attaches debug data to window object. Should be removed or guarded behind development mode check." },
      ];

      const improvements = [
        { title: "[CODE-ANALYSIS] Improvement: Refactor hardcoded path allowlists", description: "EPM_ALLOWED_PATHS and PM_ALLOWED_PATHS are hardcoded arrays. Move to a configuration-driven permission system." },
        { title: "[CODE-ANALYSIS] Improvement: Add React error boundaries", description: "Major page sections lack error boundaries. Unhandled errors crash the entire app instead of showing graceful fallbacks." },
        { title: "[CODE-ANALYSIS] Improvement: Virtual scrolling for large lists", description: "Smart import user lists and large data grids render all items at once. Add virtualization (react-window or similar) for performance." },
        { title: "[CODE-ANALYSIS] Improvement: Add CSRF protection", description: "State-changing forms lack CSRF tokens. Add CSRF protection middleware for non-API form submissions." },
        { title: "[CODE-ANALYSIS] Improvement: Add ARIA labels for accessibility", description: "Interactive elements and navigation lack comprehensive ARIA labels. Improves accessibility for screen readers." },
        { title: "[CODE-ANALYSIS] Improvement: Eliminate 'as any' TypeScript casts", description: "Systematic review and replacement of 'as any' casts with proper type definitions across the codebase." },
      ];

      const features = [
        { title: "[CODE-ANALYSIS] Feature: Task templates for common workflows", description: "Pre-defined task templates for engineering assessments, construction phases, and handover procedures." },
        { title: "[CODE-ANALYSIS] Feature: Sprint/iteration planning", description: "Time-boxed iteration planning with velocity tracking and burndown charts." },
        { title: "[CODE-ANALYSIS] Feature: Workload balancing view", description: "Visual dashboard showing task distribution per team member to identify overloaded or underutilized resources." },
        { title: "[CODE-ANALYSIS] Feature: Task automation rules", description: "Configurable rules for auto-assignment, status transitions, and notification triggers based on task events." },
        { title: "[CODE-ANALYSIS] Feature: Task metrics report generation", description: "Exportable reports showing team velocity, completion trends, time tracking summaries, and blocker analysis." },
      ];

      // Get tag IDs
      const allTags = await db.select().from(taskTags);
      const bugTagId = allTags.find((t) => t.name === "Bug")?.id;
      const improvementTagId = allTags.find((t) => t.name === "Improvement")?.id;
      const featureTagId = allTags.find((t) => t.name === "Feature")?.id;
      const securityTagId = allTags.find((t) => t.name === "Security")?.id;
      const criticalTagId = allTags.find((t) => t.name === "Critical")?.id;

      // Insert bugs
      for (const bug of bugs) {
        const [item] = await db.insert(workItems).values({
          projectId: project.id,
          workstream: "ENG",
          title: bug.title,
          description: bug.description,
          status: "Not Started",
          priority: bug.priority,
          taskCategory: "BUG",
          source: "UI",
          createdBy: user.id,
          ownerUserId: user.id,
        } as any).returning();

        const tags = [bugTagId];
        if (bug.priority === "Critical" && criticalTagId) tags.push(criticalTagId);
        if (bug.title.includes("Auth") || bug.title.includes("access code")) {
          if (securityTagId) tags.push(securityTagId);
        }

        for (const tId of tags) {
          if (tId) {
            await db.insert(workItemTags).values({ workItemId: item.id, tagId: tId }).onConflictDoNothing();
          }
        }
      }

      // Insert improvements
      for (const imp of improvements) {
        const [item] = await db.insert(workItems).values({
          projectId: project.id,
          workstream: "ENG",
          title: imp.title,
          description: imp.description,
          status: "Not Started",
          priority: "Medium",
          taskCategory: "IMPROVEMENT",
          source: "UI",
          createdBy: user.id,
          ownerUserId: user.id,
        } as any).returning();

        if (improvementTagId) {
          await db.insert(workItemTags).values({ workItemId: item.id, tagId: improvementTagId }).onConflictDoNothing();
        }
      }

      // Insert features
      for (const feat of features) {
        const [item] = await db.insert(workItems).values({
          projectId: project.id,
          workstream: "ENG",
          title: feat.title,
          description: feat.description,
          status: "Not Started",
          priority: "Low",
          taskCategory: "FEATURE",
          source: "UI",
          createdBy: user.id,
          ownerUserId: user.id,
        } as any).returning();

        if (featureTagId) {
          await db.insert(workItemTags).values({ workItemId: item.id, tagId: featureTagId }).onConflictDoNothing();
        }
      }

      res.json({
        message: "Seeded successfully",
        seeded: true,
        counts: { bugs: bugs.length, improvements: improvements.length, features: features.length },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
