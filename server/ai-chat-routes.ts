import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "./permission-middleware";
import { checkPermission, type PermissionEntity } from "@shared/schema";

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "dummy",
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
  });
}

const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4000),
  })).min(1).max(50),
  screenPath: z.string().max(500).optional(),
  projectName: z.string().max(200).optional(),
});

const FINANCIAL_ROLES = ['COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO', 'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER', 'ACCOUNTANT'];

async function gatherContext(screenPath: string, userRole: string, projectName?: string): Promise<string> {
  const parts: string[] = [];
  parts.push(`The user is currently viewing: ${screenPath}`);
  parts.push(`User role: ${userRole}`);

  const canViewFinancials = checkPermission(userRole, 'financials' as PermissionEntity, 'view');
  const canViewProjects = checkPermission(userRole, 'projects' as PermissionEntity, 'view');

  if (canViewProjects) {
    try {
      const projectsResult = await db.execute(sql.raw(`
        SELECT name, status, project_type, rag_status, pm_percentage_complete, client
        FROM project_info ORDER BY name LIMIT 100
      `));
      const projects = projectsResult.rows || [];
      if (projects.length > 0) {
        parts.push(`\n--- PROJECTS (${projects.length} total) ---`);
        for (const p of projects) {
          parts.push(`• ${p.name} | Status: ${p.status || 'N/A'} | RAG: ${p.rag_status || 'N/A'} | Complete: ${p.pm_percentage_complete || 0}%`);
        }
      }
    } catch (e) {}
  }

  if (projectName) {
    if (canViewFinancials) {
      try {
        const costResult = await db.execute(sql`
          SELECT COUNT(*) as count,
            COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN CAST(amount AS numeric) ELSE 0 END), 0) as total_paid,
            COALESCE(SUM(CAST(amount AS numeric)), 0) as total_amount
          FROM normalized_cost_lines WHERE project_name = ${projectName}
        `);
        const costs = costResult.rows?.[0];
        if (costs) {
          parts.push(`\n--- COSTS for ${projectName} ---`);
          parts.push(`Total cost lines: ${costs.count}, Total amount: R${Number(costs.total_amount).toLocaleString()}, Total paid: R${Number(costs.total_paid).toLocaleString()}`);
        }
      } catch (e) {}

      try {
        const revResult = await db.execute(sql`
          SELECT COUNT(*) as count,
            COALESCE(SUM(CAST(costed_value AS numeric)), 0) as total_costed,
            COALESCE(SUM(CASE WHEN actual_value IS NOT NULL THEN CAST(actual_value AS numeric) ELSE 0 END), 0) as total_actual
          FROM normalized_revenue_lines WHERE project_name = ${projectName}
        `);
        const rev = revResult.rows?.[0];
        if (rev) {
          parts.push(`\n--- REVENUE for ${projectName} ---`);
          parts.push(`Total revenue lines: ${rev.count}, Total costed: R${Number(rev.total_costed).toLocaleString()}, Total actual: R${Number(rev.total_actual).toLocaleString()}`);
        }
      } catch (e) {}
    }

    try {
      const taskResult = await db.execute(sql`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN status IN ('COMPLETE','complete','Done') THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE AND status NOT IN ('COMPLETE','complete','Done') THEN 1 ELSE 0 END) as overdue
        FROM work_items WHERE project_name = ${projectName}
      `);
      const tasks = taskResult.rows?.[0];
      if (tasks) {
        parts.push(`\n--- TASKS for ${projectName} ---`);
        parts.push(`Total: ${tasks.total}, Completed: ${tasks.completed}, Overdue: ${tasks.overdue}`);
      }
    } catch (e) {}
  }

  try {
    const overallResult = await db.execute(sql.raw(`
      SELECT
        (SELECT COUNT(*) FROM work_items WHERE status NOT IN ('COMPLETE','complete','Done') AND due_date < CURRENT_DATE) as overdue_tasks,
        (SELECT COUNT(*) FROM work_items WHERE status NOT IN ('COMPLETE','complete','Done')) as active_tasks,
        (SELECT COUNT(DISTINCT project_name) FROM work_items) as projects_with_tasks
    `));
    const overall = overallResult.rows?.[0];
    if (overall) {
      parts.push(`\n--- OVERALL STATS ---`);
      parts.push(`Active tasks: ${overall.active_tasks}, Overdue: ${overall.overdue_tasks}, Projects with tasks: ${overall.projects_with_tasks}`);
    }
  } catch (e) {}

  return parts.join("\n");
}

export function registerAiChatRoutes(app: Express) {
  app.post("/api/ai-chat", requirePermission("emergent_gpt", "view"), async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
    }

    const { messages, screenPath, projectName } = parsed.data;
    const userRole = (req as any).user?.role || "UNKNOWN";
    let aborted = false;

    req.on("close", () => { aborted = true; });

    try {
      const context = await gatherContext(screenPath || "/", userRole, projectName);

      const systemMessage = `You are Emergent GPT, an intelligent assistant built into the Emergent Energy Dashboard. You help users understand their renewable energy project data, finances, tasks, and operations.

You have access to live data from the system. Here is the current context:

${context}

Key things to know about the system:
- Financial year runs September to August
- Revenue tracking uses "Actual vs Costed" terminology
- COS = Cost of Sales
- GP% = Gross Profit percentage
- RAG = Red/Amber/Green status indicators
- Projects go through lifecycle stages from Development to Handover
- Engineering has 5 stages with checklists
- Currency is South African Rand (R)

Guidelines:
- Be concise and helpful
- Reference specific data when answering questions
- If you don't have enough data to answer, say so clearly
- Use the project and financial data provided to give accurate answers
- Format numbers with commas for readability
- When discussing financials, always mention the currency (R)`;

      const chatMessages = [
        { role: "system" as const, content: systemMessage },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const openai = getOpenAI();
      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        stream: true,
        max_completion_tokens: 2048,
      });

      for await (const chunk of stream) {
        if (aborted) break;
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      if (!aborted) {
        res.write("data: [DONE]\n\n");
      }
      res.end();
    } catch (error: any) {
      console.error("[AI Chat] Error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate response" });
      } else if (!aborted) {
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
        res.end();
      }
    }
  });
}
