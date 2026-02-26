import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { normalizedCostLines, counterparties, programExpense, projectInfo, invoicePatternRules } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { extractSupplierName } from "./lib/calculations/supplierExtractor";
import { verifyToken } from "./jwt";
import { requirePermission } from "./permission-middleware";

const router = Router();

function jwtAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const decoded = verifyToken(authHeader.slice(7));
    if (decoded) {
      (req as any).user = { id: decoded.userId, role: decoded.role };
    }
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() || (req as any).user) return next();
  res.status(401).json({ error: "auth_required" });
}

router.use(jwtAuth);

router.get("/api/subcontractor-dashboard/summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const typeFilter = req.query.type as string | undefined;
    const projectFilter = req.query.project as string | undefined;
    const coreOnly = req.query.coreOnly === "true";

    const allLines = await db.select().from(normalizedCostLines);

    let lines = allLines;
    if (typeFilter && typeFilter !== "all") {
      lines = lines.filter(l => l.counterpartyType === typeFilter);
    }
    if (projectFilter && projectFilter !== "all") {
      lines = lines.filter(l => l.projectName === projectFilter);
    }

    const counterpartyList = await db.select().from(counterparties);
    const cpMap = new Map(counterpartyList.map(c => [c.id, c]));

    if (coreOnly) {
      const coreIds = new Set(counterpartyList.filter(c => c.isCore).map(c => c.id));
      lines = lines.filter(l => l.counterpartyId && coreIds.has(l.counterpartyId));
    }

    const grouped = new Map<string, typeof lines>();
    for (const line of lines) {
      const key = line.counterpartyName?.trim()?.toLowerCase() || "unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(line);
    }

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    interface CounterpartySummary {
      counterpartyName: string;
      counterpartyId: number | null;
      counterpartyType: string | null;
      isCore: boolean;
      totalSpendExVat: number;
      invoiceCount: number;
      projectCount: number;
      projectNames: string[];
      lastInvoiceDate: string | null;
      lastPaidDate: string | null;
      avgTurnaroundDays: number | null;
      openAmount: number;
      upcomingAmount30d: number;
    }

    const summaries: CounterpartySummary[] = [];

    for (const [key, groupLines] of grouped) {
      const name = groupLines[0]?.counterpartyName || "Unknown";
      const cpId = groupLines[0]?.counterpartyId || null;
      const cp = cpId ? cpMap.get(cpId) : null;
      const cpType = groupLines[0]?.counterpartyType || cp?.typeDefault || null;

      let totalSpend = 0;
      const invoiceNumbers = new Set<string>();
      const projects = new Set<string>();
      let lastInvoiceDate: string | null = null;
      let lastPaidDate: string | null = null;
      let turnaroundSum = 0;
      let turnaroundCount = 0;
      let openAmount = 0;
      let upcomingAmount = 0;

      for (const line of groupLines) {
        const amt = parseFloat(line.amountExVat || "0") || 0;
        totalSpend += amt;

        if (line.invoiceNumber) invoiceNumbers.add(line.invoiceNumber);
        projects.add(line.projectName);

        if (line.invoiceDate && (!lastInvoiceDate || line.invoiceDate > lastInvoiceDate)) {
          lastInvoiceDate = line.invoiceDate;
        }
        if (line.paidDate && (!lastPaidDate || line.paidDate > lastPaidDate)) {
          lastPaidDate = line.paidDate;
        }

        if (line.turnaroundDays != null) {
          turnaroundSum += line.turnaroundDays;
          turnaroundCount++;
        }

        if (line.status !== "PAID" && amt > 0) {
          openAmount += amt;
        }

        if (line.invoiceDate && line.status !== "PAID") {
          try {
            const invDate = new Date(line.invoiceDate);
            if (invDate >= now && invDate <= thirtyDaysFromNow) {
              upcomingAmount += amt;
            }
          } catch {}
        }
      }

      summaries.push({
        counterpartyName: name,
        counterpartyId: cpId,
        counterpartyType: cpType,
        isCore: cp?.isCore || false,
        totalSpendExVat: totalSpend,
        invoiceCount: invoiceNumbers.size || groupLines.length,
        projectCount: projects.size,
        projectNames: Array.from(projects).sort(),
        lastInvoiceDate,
        lastPaidDate,
        avgTurnaroundDays: turnaroundCount > 0 ? Math.round(turnaroundSum / turnaroundCount) : null,
        openAmount,
        upcomingAmount30d: upcomingAmount,
      });
    }

    summaries.sort((a, b) => b.totalSpendExVat - a.totalSpendExVat);

    const biggest = summaries.find(s => s.counterpartyName.toLowerCase() !== "unknown") || null;
    const totalCounterparties = summaries.length;
    const totalOpenAmount = summaries.reduce((s, c) => s + c.openAmount, 0);
    const totalUpcoming30d = summaries.reduce((s, c) => s + c.upcomingAmount30d, 0);
    const allProjects = [...new Set(lines.map(l => l.projectName))];

    res.json({
      kpis: {
        biggestAccount: biggest?.counterpartyName || "None",
        biggestAccountSpend: biggest?.totalSpendExVat || 0,
        totalCounterparties,
        totalOpenAmount,
        totalUpcoming30d,
      },
      counterparties: summaries,
      availableProjects: allProjects,
    });
  } catch (err: any) {
    console.error("[subcontractor-dashboard] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/subcontractor-dashboard/detail/:name", requireAuth, async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const allLines = await db.select().from(normalizedCostLines);
    const normalizedName = name.trim().toLowerCase();
    const lines = allLines.filter(l => {
      const cpName = (l.counterpartyName || "").trim().toLowerCase();
      if (normalizedName === "unknown") {
        return cpName === "unknown" || cpName === "";
      }
      return cpName === normalizedName;
    });

    if (lines.length === 0) {
      return res.json({ lines: [], upcoming: [], projectBreakdown: [], monthlyTrend: [] });
    }

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const upcoming = lines
      .filter(l => {
        if (l.status === "PAID") return false;
        if (!l.invoiceDate) return false;
        try {
          const d = new Date(l.invoiceDate);
          return d >= now && d <= thirtyDaysFromNow;
        } catch { return false; }
      })
      .map(l => ({
        projectName: l.projectName,
        description: l.description,
        amountExVat: l.amountExVat,
        invoiceDate: l.invoiceDate,
        status: l.status,
      }));

    const projectMap = new Map<string, { totalSpend: number; lineCount: number; paidAmount: number; openAmount: number; paidCount: number; openCount: number }>();
    for (const l of lines) {
      const key = l.projectName;
      if (!projectMap.has(key)) projectMap.set(key, { totalSpend: 0, lineCount: 0, paidAmount: 0, openAmount: 0, paidCount: 0, openCount: 0 });
      const p = projectMap.get(key)!;
      const amt = parseFloat(l.amountExVat || "0") || 0;
      p.totalSpend += amt;
      p.lineCount++;
      if (l.status === "PAID") { p.paidAmount += amt; p.paidCount++; }
      else { p.openAmount += amt; p.openCount++; }
    }
    const projectBreakdown = Array.from(projectMap.entries()).map(([name, v]) => ({
      projectName: name, ...v,
    }));

    const invoiceSummary = {
      totalInvoices: lines.length,
      totalAmount: lines.reduce((s, l) => s + (parseFloat(l.amountExVat || "0") || 0), 0),
      settled: {
        count: lines.filter(l => l.status === "PAID").length,
        amount: lines.filter(l => l.status === "PAID").reduce((s, l) => s + (parseFloat(l.amountExVat || "0") || 0), 0),
      },
      outstanding: {
        count: lines.filter(l => l.status !== "PAID").length,
        amount: lines.filter(l => l.status !== "PAID").reduce((s, l) => s + (parseFloat(l.amountExVat || "0") || 0), 0),
      },
      invoiced: {
        count: lines.filter(l => l.status === "INVOICED").length,
        amount: lines.filter(l => l.status === "INVOICED").reduce((s, l) => s + (parseFloat(l.amountExVat || "0") || 0), 0),
      },
      planned: {
        count: lines.filter(l => l.status === "PLANNED").length,
        amount: lines.filter(l => l.status === "PLANNED").reduce((s, l) => s + (parseFloat(l.amountExVat || "0") || 0), 0),
      },
      approved: {
        count: lines.filter(l => l.status === "APPROVED").length,
        amount: lines.filter(l => l.status === "APPROVED").reduce((s, l) => s + (parseFloat(l.amountExVat || "0") || 0), 0),
      },
    };

    const monthMap = new Map<string, number>();
    for (const l of lines) {
      const d = l.invoiceDate || l.paidDate;
      if (!d) continue;
      try {
        const dt = new Date(d);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        monthMap.set(key, (monthMap.get(key) || 0) + (parseFloat(l.amountExVat || "0") || 0));
      } catch {}
    }
    const monthlyTrend = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, total]) => ({ month, total }));

    const lastActivity = lines.reduce((max, l) => {
      const d = l.paidDate || l.invoiceDate;
      if (d && (!max || d > max)) return d;
      return max;
    }, null as string | null);

    const oldestOpen = lines
      .filter(l => l.status !== "PAID" && l.invoiceDate)
      .reduce((min, l) => {
        if (!min || (l.invoiceDate && l.invoiceDate < min)) return l.invoiceDate;
        return min;
      }, null as string | null);

    const nextDue = upcoming.length > 0
      ? upcoming.reduce((min, u) => (!min || (u.invoiceDate && u.invoiceDate < min) ? u.invoiceDate : min), null as string | null)
      : null;

    res.json({
      invoiceSummary,
      lines: lines.map(l => ({
        id: l.id,
        projectName: l.projectName,
        description: l.description,
        amountExVat: l.amountExVat,
        invoiceNumber: l.invoiceNumber,
        invoiceDate: l.invoiceDate,
        paidDate: l.paidDate,
        status: l.status,
        costCategory: l.costCategory,
        turnaroundDays: l.turnaroundDays,
      })),
      upcoming,
      projectBreakdown,
      monthlyTrend,
      linkedDates: {
        lastActivity,
        oldestOpen,
        nextDue,
      },
    });
  } catch (err: any) {
    console.error("[subcontractor-detail] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/procurement-analysis/run", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || null;

    const expenses = await db.select().from(programExpense);
    if (expenses.length === 0) {
      return res.json({ success: true, costLines: 0, counterpartiesCreated: 0, counterpartiesMatched: 0, projects: 0, message: "No expense data found" });
    }

    const projects = await db.select().from(projectInfo);
    const projectMap = new Map(projects.map((p: any) => [p.projectName, p.id]));

    const supplierNames = new Set<string>();
    for (const exp of expenses) {
      const supplier = exp.supplierName || extractSupplierName(exp.expenseInvoiceNumber);
      if (supplier?.trim()) supplierNames.add(supplier.trim());
    }

    let counterpartiesCreated = 0;
    let counterpartiesMatched = 0;
    const counterpartyMap = new Map<string, number>();

    await db.transaction(async (tx: any) => {
      const allCps = await tx.select().from(counterparties);
      const aliasIndex = new Map<string, number>();
      for (const cp of allCps) {
        aliasIndex.set(cp.nameCanonical.toLowerCase(), cp.id);
        const aliases = Array.isArray(cp.nameAliases) ? cp.nameAliases as string[] : [];
        for (const alias of aliases) {
          aliasIndex.set(alias.toLowerCase(), cp.id);
        }
      }

      const supplierArray = Array.from(supplierNames);
      for (const name of supplierArray) {
        const normalized = name.toLowerCase();
        const matchedId = aliasIndex.get(normalized);

        if (matchedId) {
          counterpartyMap.set(normalized, matchedId);
          await tx.update(counterparties)
            .set({ lastSeenAt: new Date() })
            .where(eq(counterparties.id, matchedId));
          counterpartiesMatched++;
        } else {
          const [created] = await tx.insert(counterparties)
            .values({
              nameCanonical: name,
              nameAliases: [],
              typeDefault: "OTHER",
              isCore: false,
              createdBy: userId,
              lastSeenAt: new Date(),
            })
            .returning();
          counterpartyMap.set(normalized, created.id);
          aliasIndex.set(normalized, created.id);
          counterpartiesCreated++;
        }
      }

      await tx.delete(normalizedCostLines).where(
        sql`${normalizedCostLines.sourceSheet} = 'program_expense'`
      );

      const projectsProcessed = new Set<string>();
      const costValues: any[] = [];

      for (const exp of expenses) {
        const actualAmount = parseFloat(String(exp.expenseActualTotal || '0')) || 0;
        const hasInvoice = !!(exp.expenseInvoiceNumber && String(exp.expenseInvoiceNumber).trim());
        if (actualAmount === 0 || !hasInvoice) continue;

        const supplier = exp.supplierName || extractSupplierName(exp.expenseInvoiceNumber);
        const cpName = supplier?.trim() || null;
        const cpId = cpName ? counterpartyMap.get(cpName.toLowerCase()) || null : null;
        const projId = projectMap.get(exp.projectName) || null;
        if (exp.projectName) projectsProcessed.add(exp.projectName);

        let status: string | null = null;
        const now = new Date();
        if (exp.expensePaymentDate) {
          const paidD = new Date(exp.expensePaymentDate);
          if (paidD <= now) {
            status = "PAID";
          } else {
            status = exp.expenseInvoicedDate ? "INVOICED" : "APPROVED";
          }
        } else if (exp.expenseInvoicedDate) {
          status = "INVOICED";
        } else if (exp.expensePoNumber) {
          status = "APPROVED";
        } else {
          status = "PLANNED";
        }

        let turnaroundDays: number | null = null;
        if (exp.expensePaymentDate && exp.expenseInvoicedDate) {
          const paid = new Date(exp.expensePaymentDate);
          const invoiced = new Date(exp.expenseInvoicedDate);
          turnaroundDays = Math.max(0, Math.round((paid.getTime() - invoiced.getTime()) / (1000 * 60 * 60 * 24)));
        }

        const matchedCp = cpId ? allCps.find(c => c.id === cpId) : null;
        const cpType = matchedCp?.typeDefault || null;

        costValues.push({
          projectId: projId,
          projectName: exp.projectName || "Unknown",
          costCategory: exp.expenseCategory,
          counterpartyId: cpId,
          counterpartyName: cpName,
          counterpartyType: cpType,
          description: exp.expenseLineItem,
          amountExVat: exp.expenseActualTotal ? String(exp.expenseActualTotal) : null,
          invoiceNumber: exp.expenseInvoiceNumber,
          invoiceDate: exp.expenseInvoicedDate,
          approvedDate: null,
          paidDate: exp.expensePaymentDate,
          poNumber: exp.expensePoNumber,
          status,
          sourceSheet: "program_expense",
          sourceRow: exp.rowNumber || exp.id,
          importRunId: null,
          turnaroundDays,
        });
      }

      const batchSize = 500;
      for (let i = 0; i < costValues.length; i += batchSize) {
        const batch = costValues.slice(i, i + batchSize);
        await tx.insert(normalizedCostLines).values(batch);
      }

      console.log(`[procurement-analysis] Processed ${costValues.length} cost lines, ${counterpartiesCreated} new counterparties, ${projectsProcessed.size} projects`);

      res.json({
        success: true,
        costLines: costValues.length,
        counterpartiesCreated,
        counterpartiesMatched,
        projects: projectsProcessed.size,
        message: `Rebuilt ${costValues.length} cost lines across ${projectsProcessed.size} projects with ${counterpartiesCreated + counterpartiesMatched} suppliers`,
      });
    });
  } catch (err: any) {
    console.error("[procurement-analysis] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/procurement-analysis/status", requireAuth, async (_req: Request, res: Response) => {
  try {
    const [costResult] = await db.select({ count: sql<number>`count(*)` }).from(normalizedCostLines);
    const [cpResult] = await db.select({ count: sql<number>`count(*)` }).from(counterparties);
    const [expResult] = await db.select({ count: sql<number>`count(*)` }).from(programExpense);
    res.json({
      costLines: Number(costResult.count),
      counterparties: Number(cpResult.count),
      sourceExpenses: Number(expResult.count),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/subcontractor-dashboard/rename", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName || typeof oldName !== "string" || typeof newName !== "string") {
      return res.status(400).json({ error: "Both oldName and newName are required" });
    }
    const trimmedNew = newName.trim();
    if (trimmedNew.length < 1) {
      return res.status(400).json({ error: "New name cannot be empty" });
    }

    const existingCp = await db.select().from(counterparties)
      .where(sql`LOWER(${counterparties.nameCanonical}) = LOWER(${trimmedNew})`);

    const oldCp = await db.select().from(counterparties)
      .where(sql`LOWER(${counterparties.nameCanonical}) = LOWER(${oldName.trim()})`);

    if (existingCp.length > 0 && oldCp.length > 0 && existingCp[0].id !== oldCp[0].id) {
      return res.status(409).json({ error: "A counterparty with that name already exists" });
    }

    await db.transaction(async (tx) => {
      if (oldCp.length > 0) {
        const currentAliases: string[] = Array.isArray(oldCp[0].nameAliases) ? oldCp[0].nameAliases as string[] : [];
        const newAliases = [...new Set([...currentAliases, oldCp[0].nameCanonical])];
        await tx.update(counterparties)
          .set({ nameCanonical: trimmedNew, nameAliases: newAliases, lastSeenAt: new Date() })
          .where(eq(counterparties.id, oldCp[0].id));
      }

      const updated = await tx.update(normalizedCostLines)
        .set({ counterpartyName: trimmedNew })
        .where(sql`LOWER(TRIM(${normalizedCostLines.counterpartyName})) = LOWER(${oldName.trim()})`);
    });

    console.log(`[subcontractor] Renamed "${oldName}" → "${trimmedNew}"`);
    res.json({ success: true, oldName, newName: trimmedNew });
  } catch (err: any) {
    console.error("[subcontractor-rename] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/subcontractor-dashboard/counterparty/:name", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name);
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Counterparty name is required" });
    }

    const normalized = name.trim().toLowerCase();

    await db.transaction(async (tx) => {
      const cpRows = await tx.select().from(counterparties)
        .where(sql`LOWER(${counterparties.nameCanonical}) = ${normalized}`);

      if (cpRows.length > 0) {
        const cpId = cpRows[0].id;
        await tx.delete(normalizedCostLines)
          .where(sql`${normalizedCostLines.counterpartyId} = ${cpId} OR LOWER(TRIM(${normalizedCostLines.counterpartyName})) = ${normalized}`);
        await tx.delete(counterparties).where(eq(counterparties.id, cpId));
      } else {
        await tx.delete(normalizedCostLines)
          .where(sql`LOWER(TRIM(${normalizedCostLines.counterpartyName})) = ${normalized}`);
      }
    });

    console.log(`[subcontractor] Deleted counterparty "${name}" and associated cost lines`);
    res.json({ success: true, deleted: name });
  } catch (err: any) {
    console.error("[subcontractor-delete] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/subcontractor-dashboard/counterparty/:name/type", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const { type } = req.body;
    if (!type || !["INSTALLER", "SUPPLIER", "OTHER"].includes(type)) {
      return res.status(400).json({ error: "Type must be INSTALLER, SUPPLIER, or OTHER" });
    }

    const normalized = name.trim().toLowerCase();

    await db.transaction(async (tx) => {
      const cpRows = await tx.select().from(counterparties)
        .where(sql`LOWER(${counterparties.nameCanonical}) = ${normalized}`);

      if (cpRows.length > 0) {
        const cpId = cpRows[0].id;
        await tx.update(counterparties)
          .set({ typeDefault: type, lastSeenAt: new Date() })
          .where(eq(counterparties.id, cpId));

        await tx.update(normalizedCostLines)
          .set({ counterpartyType: type })
          .where(sql`${normalizedCostLines.counterpartyId} = ${cpId} OR LOWER(TRIM(${normalizedCostLines.counterpartyName})) = ${normalized}`);
      } else {
        await tx.update(normalizedCostLines)
          .set({ counterpartyType: type })
          .where(sql`LOWER(TRIM(${normalizedCostLines.counterpartyName})) = ${normalized}`);
      }
    });

    console.log(`[subcontractor] Changed type of "${name}" to ${type}`);
    res.json({ success: true, name, type });
  } catch (err: any) {
    console.error("[subcontractor-type] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/subcontractor-dashboard/merge", requireAuth, requirePermission('procurement', 'edit'), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user || {};
    const rawRole = user.role || '';
    const userRole = rawRole === 'admin' ? 'COO_ADMIN' : rawRole;
    const adminRoles = ['admin', 'COO_ADMIN', 'CEO_ADMIN'];
    if (!adminRoles.includes(userRole)) {
      return res.status(403).json({ error: "Only admin users can merge counterparties" });
    }
    const { sourceNames, targetName } = req.body;
    if (!Array.isArray(sourceNames) || sourceNames.length === 0 || !targetName || typeof targetName !== "string") {
      return res.status(400).json({ error: "sourceNames (array) and targetName (string) are required" });
    }

    const trimmedTarget = targetName.trim();
    if (!trimmedTarget) {
      return res.status(400).json({ error: "Target name cannot be empty" });
    }

    const normalizedSources = sourceNames.map((n: string) => n.trim().toLowerCase());
    const normalizedTarget = trimmedTarget.toLowerCase();

    let mergedAliasCount = 0;
    await db.transaction(async (tx) => {
      const targetCp = await tx.select().from(counterparties)
        .where(sql`LOWER(${counterparties.nameCanonical}) = ${normalizedTarget}`);

      let targetCpId: number;
      let mergedAliases: string[] = [];

      if (targetCp.length > 0) {
        targetCpId = targetCp[0].id;
        mergedAliases = Array.isArray(targetCp[0].nameAliases) ? targetCp[0].nameAliases as string[] : [];
      } else {
        const [created] = await tx.insert(counterparties)
          .values({
            nameCanonical: trimmedTarget,
            nameAliases: [],
            typeDefault: "OTHER",
            isCore: false,
            lastSeenAt: new Date(),
          })
          .returning();
        targetCpId = created.id;
      }

      for (const srcNorm of normalizedSources) {
        if (srcNorm === normalizedTarget) continue;

        const srcCp = await tx.select().from(counterparties)
          .where(sql`LOWER(${counterparties.nameCanonical}) = ${srcNorm}`);

        if (srcCp.length > 0) {
          const srcId = srcCp[0].id;
          mergedAliases.push(srcCp[0].nameCanonical);
          const srcAliases = Array.isArray(srcCp[0].nameAliases) ? srcCp[0].nameAliases as string[] : [];
          mergedAliases.push(...srcAliases);

          await tx.update(normalizedCostLines)
            .set({ counterpartyName: trimmedTarget, counterpartyId: targetCpId })
            .where(sql`${normalizedCostLines.counterpartyId} = ${srcId} OR LOWER(TRIM(${normalizedCostLines.counterpartyName})) = ${srcNorm}`);

          await tx.delete(counterparties).where(eq(counterparties.id, srcId));
        } else {
          await tx.update(normalizedCostLines)
            .set({ counterpartyName: trimmedTarget, counterpartyId: targetCpId })
            .where(sql`LOWER(TRIM(${normalizedCostLines.counterpartyName})) = ${srcNorm}`);
        }
      }

      const uniqueAliases = [...new Set(mergedAliases.filter(a => a.toLowerCase() !== normalizedTarget))];
      mergedAliasCount = uniqueAliases.length;
      await tx.update(counterparties)
        .set({ nameAliases: uniqueAliases, lastSeenAt: new Date() })
        .where(eq(counterparties.id, targetCpId));

      const targetCpFinal = await tx.select().from(counterparties).where(eq(counterparties.id, targetCpId));
      const targetType = targetCpFinal[0]?.typeDefault || "OTHER";

      for (const alias of uniqueAliases) {
        const existing = await tx.select().from(invoicePatternRules)
          .where(sql`${invoicePatternRules.patternType} = 'PREFIX' AND LOWER(${invoicePatternRules.patternValue}) = ${alias.toLowerCase()} AND ${invoicePatternRules.counterpartyId} = ${targetCpId}`);

        if (existing.length === 0) {
          await tx.insert(invoicePatternRules).values({
            patternType: "PREFIX",
            patternValue: alias,
            normalizedExample: alias,
            counterpartyId: targetCpId,
            counterpartyName: trimmedTarget,
            inferredType: targetType as any,
            confidenceWeight: 90,
            isActive: true,
          });
        }
      }
    });

    console.log(`[subcontractor] Merged [${sourceNames.join(", ")}] → "${trimmedTarget}" with ${mergedAliasCount} alias patterns`);
    res.json({ success: true, merged: sourceNames, into: trimmedTarget });
  } catch (err: any) {
    console.error("[subcontractor-merge] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/subcontractor-dashboard/link-counterparty", requireAuth, async (req: Request, res: Response) => {
  try {
    const { costLineIds, counterpartyId, counterpartyName, counterpartyType, createPattern } = req.body;
    if (!costLineIds || !Array.isArray(costLineIds) || costLineIds.length === 0) {
      return res.status(400).json({ error: "costLineIds array is required" });
    }
    if (!counterpartyId && !counterpartyName) {
      return res.status(400).json({ error: "counterpartyId or counterpartyName is required" });
    }

    let cpId = counterpartyId;
    let cpName = counterpartyName;
    let cpType = counterpartyType || null;

    if (cpId) {
      const [cp] = await db.select().from(counterparties).where(eq(counterparties.id, cpId));
      if (cp) {
        cpName = cp.nameCanonical;
        cpType = cpType || cp.typeDefault;
      }
    } else if (cpName) {
      const existing = await db.select().from(counterparties)
        .where(sql`LOWER(${counterparties.nameCanonical}) = LOWER(${cpName.trim()})`);
      if (existing.length > 0) {
        cpId = existing[0].id;
        cpName = existing[0].nameCanonical;
        cpType = cpType || existing[0].typeDefault;
      } else {
        const [newCp] = await db.insert(counterparties).values({
          nameCanonical: cpName.trim(),
          typeDefault: cpType || "OTHER",
          nameAliases: [],
          isCore: false,
          lastSeenAt: new Date(),
        }).returning();
        cpId = newCp.id;
        cpName = newCp.nameCanonical;
        cpType = cpType || newCp.typeDefault;
        console.log(`[subcontractor] Created new counterparty "${cpName}" (id=${cpId})`);
      }
    }

    await db.transaction(async (tx: any) => {
      for (const lineId of costLineIds) {
        await tx.update(normalizedCostLines)
          .set({
            counterpartyId: cpId || null,
            counterpartyName: cpName,
            counterpartyType: cpType,
          })
          .where(eq(normalizedCostLines.id, lineId));
      }
    });

    let patternCreated = null;
    if (createPattern) {
      const lines = await db.select().from(normalizedCostLines).where(
        sql`${normalizedCostLines.id} = ANY(${costLineIds})`
      );
      const invoiceNumbers = lines.map(l => l.invoiceNumber).filter(Boolean);
      if (invoiceNumbers.length > 0) {
        const userId = (req as any).user?.id || null;
        const prefixMatch = invoiceNumbers[0]!.match(/^([A-Za-z\-_]+)/);
        const patternValue = prefixMatch ? prefixMatch[1] : invoiceNumbers[0]!;
        const [rule] = await db
          .insert(invoicePatternRules)
          .values({
            patternType: "PREFIX",
            patternValue: patternValue,
            normalizedExample: invoiceNumbers[0],
            counterpartyId: cpId || null,
            counterpartyName: cpName,
            inferredType: cpType || "OTHER",
            confidenceWeight: 60,
            createdBy: userId,
            isActive: true,
          })
          .returning();
        patternCreated = rule;
      }
    }

    console.log(`[subcontractor] Linked ${costLineIds.length} cost lines to "${cpName}" (id=${cpId})`);
    res.json({ success: true, linked: costLineIds.length, counterpartyName: cpName, patternCreated });
  } catch (err: any) {
    console.error("[subcontractor-link] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/subcontractor-dashboard/admin-questions", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    questions: [
      {
        id: "upcoming_date_field",
        question: "Which date field should drive 'upcoming' calculations?",
        options: ["invoice_date", "approved_date", "paid_date (forecast)", "custom expected_payment_date"],
        current: "invoice_date (defaulting to invoice date until confirmed)",
        status: "PENDING",
      },
      {
        id: "counterparty_types",
        question: "Confirm exact type labels: INSTALLER vs SUBCONTRACTOR vs CONTRACTOR?",
        options: ["INSTALLER / SUPPLIER / OTHER (current)", "CONTRACTOR / SUPPLIER / OTHER", "SUBCONTRACTOR / SUPPLIER / OTHER"],
        current: "INSTALLER / SUPPLIER / OTHER",
        status: "PENDING",
      },
      {
        id: "dashboard_roles",
        question: "Which roles should see the Subcontractor Dashboard?",
        options: ["PM team + Admin only", "All authenticated users", "COO + CFO + PM roles"],
        current: "All authenticated users (defaulting until confirmed)",
        status: "PENDING",
      },
    ],
  });
});

export function registerSubcontractorRoutes(app: any) {
  app.use(router);
}

export default router;
