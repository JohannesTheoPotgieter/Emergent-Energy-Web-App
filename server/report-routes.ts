import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { projectInfo, type ProjectInfo } from "@shared/schema";
import { verifyToken } from "./jwt";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload) {
      req.user = { id: payload.userId, email: payload.email, name: payload.name, role: payload.role } as any;
      return next();
    }
  }
  res.status(401).json({ error: "auth_required", message: "Authentication required" });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user?.role === "admin") return next();
  res.status(403).json({ error: "admin_required", message: "Admin access required" });
}

const INACTIVE_STATUSES = ["Cancelled", "Archived", "Complete", "Closed", "Handover Complete", "Completed"];

function isDateStrInMonth(dateStr: string | null | undefined, monthStartStr: string, monthEndStr: string): boolean {
  if (!dateStr) return false;
  try {
    const normalized = dateStr.substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    return normalized >= monthStartStr && normalized <= monthEndStr;
  } catch {
    return false;
  }
}

function parseMonth(monthStr: string): { monthStart: Date; monthEnd: Date; monthStartStr: string; monthEndStr: string } | null {
  const match = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const month = parseInt(match[2]);
  if (month < 1 || month > 12) return null;

  const lastDay = new Date(year, month, 0).getDate();
  const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const sast = "+02:00";
  const monthStart = new Date(`${monthStartStr}T00:00:00${sast}`);
  const monthEnd = new Date(`${monthEndStr}T23:59:59.999${sast}`);
  return { monthStart, monthEnd, monthStartStr, monthEndStr };
}

interface KPIPayload {
  month: string;
  generatedAt: string;
  kpis: {
    activeProjects: number;
    constructionStarts: number;
    pdPmHandovers: number;
    commissionings: number;
    clientHandoversPlanned: number;
  };
}

async function calculateKPIs(month: string): Promise<KPIPayload> {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error("Invalid month format. Use YYYY-MM.");

  const { monthStartStr, monthEndStr } = parsed;
  const startTs = Date.now();

  const allProjects = await db.select().from(projectInfo);

  const activeProjects = allProjects.filter((p: ProjectInfo) => {
    if (!p.isActive) return false;
    const phase = (p.phase || "").trim();
    return !INACTIVE_STATUSES.some(s => s.toLowerCase() === phase.toLowerCase());
  });

  const constructionStarts = new Set<number>();
  const pdPmHandovers = new Set<number>();
  const commissionings = new Set<number>();
  const clientHandoversPlanned = new Set<number>();

  for (const p of allProjects) {
    if (isDateStrInMonth(p.constructionStartActual, monthStartStr, monthEndStr)) {
      constructionStarts.add(p.id);
    }
    if (isDateStrInMonth(p.pdHandoverActual, monthStartStr, monthEndStr)) {
      pdPmHandovers.add(p.id);
    }
    if (isDateStrInMonth(p.commissioningActual, monthStartStr, monthEndStr)) {
      commissionings.add(p.id);
    }
    if (isDateStrInMonth(p.clientHandoverDate, monthStartStr, monthEndStr)) {
      clientHandoversPlanned.add(p.id);
    }
  }

  const duration = Date.now() - startTs;
  console.log(`[Reports] KPI calculation for ${month} took ${duration}ms`);

  return {
    month,
    generatedAt: new Date().toISOString(),
    kpis: {
      activeProjects: activeProjects.length,
      constructionStarts: constructionStarts.size,
      pdPmHandovers: pdPmHandovers.size,
      commissionings: commissionings.size,
      clientHandoversPlanned: clientHandoversPlanned.size,
    },
  };
}

export function registerReportRoutes(app: Express) {
  app.get("/api/admin/reports/operational-overview", requireAuth, requireAdmin, async (req, res) => {
    try {
      const month = req.query.month as string;
      if (!month) return res.status(400).json({ error: "month query parameter required (YYYY-MM)" });
      const result = await calculateKPIs(month);
      res.json(result);
    } catch (err: any) {
      console.error("[Reports] Error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/admin/reports/operational-overview/pdf", requireAuth, requireAdmin, async (req, res) => {
    try {
      const month = req.query.month as string;
      if (!month) return res.status(400).json({ error: "month query parameter required (YYYY-MM)" });

      const userId = (req as any).user?.id || "unknown";
      const startTs = Date.now();
      const data = await calculateKPIs(month);

      const monthLabel = (() => {
        const [y, m] = month.split("-");
        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
        return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
      })();

      const tile = (val: number | string, label: string, sub?: string) => `
        <div style="background:#1a5c3a;color:white;border-radius:16px;padding:32px 24px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:140px">
          <span style="font-size:48px;font-weight:700;line-height:1">${val}</span>
          <span style="font-size:13px;margin-top:8px;opacity:0.9;text-align:center">${label}</span>
          ${sub ? `<span style="font-size:11px;margin-top:8px;opacity:0.7;text-align:center">${sub}</span>` : ""}
        </div>`;

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter','Segoe UI',sans-serif;background:#fff}
.slide{position:relative;width:1100px;aspect-ratio:16/9;overflow:hidden}
.bar{position:absolute;right:0;top:0;bottom:0;width:64px;background:#1a5c3a}
.content{position:relative;z-index:1;padding:32px 80px 32px 40px;display:flex;flex-direction:column;height:100%}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;flex:1}
.footer{margin-top:auto;padding-top:16px;display:flex;justify-content:space-between;font-size:10px;color:#999}
</style></head><body>
<div class="slide">
  <div class="bar"></div>
  <div class="content">
    <div style="font-size:18px;font-weight:700;color:#1a5c3a;margin-bottom:4px">EMERGENT ENERGY</div>
    <h1 style="font-size:24px;font-weight:700;color:#1a5c3a;margin-top:16px">Operational Overview</h1>
    <p style="font-size:14px;color:#4a7c5e;margin-bottom:32px">${monthLabel}</p>
    <div class="grid">
      ${tile(data.kpis.activeProjects, "Active Projects")}
      ${tile(data.kpis.constructionStarts, "Construction Starts (Actual)")}
      ${tile(data.kpis.pdPmHandovers, "PD → PM Handovers")}
      ${tile(data.kpis.commissionings, "Commissionings")}
      ${tile(data.kpis.clientHandoversPlanned, "Client Handovers (Planned)")}
    </div>
    <div class="footer">
      <span>Generated: ${new Date(data.generatedAt).toLocaleString("en-ZA")}</span>
      <span style="color:#1a5c3a;font-weight:500">CONFIDENTIAL</span>
    </div>
  </div>
</div>
</body></html>`;

      const duration = Date.now() - startTs;
      console.log(`[Reports] PDF HTML generation for ${month} by user ${userId} took ${duration}ms`);

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `inline; filename="Operational Overview - ${monthLabel}.html"`);
      res.send(html);
    } catch (err: any) {
      console.error("[Reports] PDF error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

}
