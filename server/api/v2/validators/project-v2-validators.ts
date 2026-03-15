import { z } from "zod";

export const projectIdParamSchema = z.object({ projectId: z.coerce.number().int().positive() });

export const workItemCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  workstream: z.enum(["PD", "ENG", "QUALITY", "PM", "FINANCE", "PERSONAL", "GOVERNANCE"]),
  status: z.string().default("Not Started"),
  priority: z.string().optional(),
  isMilestone: z.boolean().default(false),
});

export const workItemPatchSchema = workItemCreateSchema.partial();

export const procurementItemCreateSchema = z.object({
  title: z.string().min(1),
  category: z.enum(["material", "equipment", "service", "subcontract", "other"]).default("other"),
  expectedCost: z.number().optional(),
  status: z.enum(["requested", "quoted", "approved", "ordered", "partially_received", "received", "invoiced", "closed"]).default("requested"),
  notes: z.string().optional(),
});

export const invoiceCreateSchema = z.object({
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  amount: z.number().optional(),
  status: z.enum(["captured", "submitted", "verified", "approved", "rejected"]).default("captured"),
  notes: z.string().optional(),
});
