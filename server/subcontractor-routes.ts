import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { normalizedCostLines, counterparties } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

function jwtAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || "emergent-fallback-secret");
      if (decoded && typeof decoded === "object") {
        (req as any).user = { id: decoded.userId || decoded.id, role: decoded.role };
      }
    } catch {}
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
        lastInvoiceDate,
        lastPaidDate,
        avgTurnaroundDays: turnaroundCount > 0 ? Math.round(turnaroundSum / turnaroundCount) : null,
        openAmount,
        upcomingAmount30d: upcomingAmount,
      });
    }

    summaries.sort((a, b) => b.totalSpendExVat - a.totalSpendExVat);

    const biggest = summaries[0] || null;
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
    const lines = allLines.filter(l => (l.counterpartyName || "").trim().toLowerCase() === name.trim().toLowerCase());

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

    const projectMap = new Map<string, { totalSpend: number; lineCount: number }>();
    for (const l of lines) {
      const key = l.projectName;
      if (!projectMap.has(key)) projectMap.set(key, { totalSpend: 0, lineCount: 0 });
      const p = projectMap.get(key)!;
      p.totalSpend += parseFloat(l.amountExVat || "0") || 0;
      p.lineCount++;
    }
    const projectBreakdown = Array.from(projectMap.entries()).map(([name, v]) => ({
      projectName: name, ...v,
    }));

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
      lines: lines.map(l => ({
        id: l.id,
        projectName: l.projectName,
        description: l.description,
        amountExVat: l.amountExVat,
        invoiceNumber: l.invoiceNumber,
        invoiceDate: l.invoiceDate,
        paidDate: l.paidDate,
        status: l.status,
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
