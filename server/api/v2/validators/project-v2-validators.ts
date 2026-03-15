import { z } from "zod";

export const projectIdParamSchema = z.object({ projectId: z.coerce.number().int().positive() });
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const workItemCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  workstream: z.enum(["PD", "ENG", "QUALITY", "PM", "FINANCE", "PERSONAL", "GOVERNANCE"]),
  status: z.string().default("Not Started"),
  priority: z.string().optional(),
  isMilestone: z.boolean().default(false),
  endDate: z.string().optional(),
  ownerUserId: z.number().int().optional(),
});

export const workItemPatchSchema = workItemCreateSchema.partial();

export const milestoneCreateSchema = workItemCreateSchema.extend({
  isMilestone: z.literal(true).default(true),
  workstream: z.enum(["PM", "ENG", "QUALITY", "FINANCE", "PD"]).default("PM"),
});
export const milestonePatchSchema = milestoneCreateSchema.partial();

export const procurementItemCreateSchema = z.object({
  title: z.string().min(1),
  category: z.enum(["material", "equipment", "service", "subcontract", "other"]).default("other"),
  expectedCost: z.number().nonnegative().optional(),
  quantity: z.number().positive().optional(),
  status: z.enum(["requested", "quoted", "approved", "ordered", "partially_received", "received", "invoiced", "closed"]).default("requested"),
  notes: z.string().optional(),
  requiredDate: z.string().optional(),
});

export const procurementItemPatchSchema = procurementItemCreateSchema.partial();

export const procurementPoCreateSchema = z.object({
  title: z.string().min(1),
  poId: z.number().int().positive(),
  supplierId: z.number().int().positive().optional(),
  expectedCost: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  requiredDate: z.string().optional(),
});

export const procurementPoPatchSchema = procurementPoCreateSchema.partial().extend({
  status: z.enum(["quoted", "approved", "ordered", "partially_received", "received", "invoiced", "closed"]).optional(),
});

export const invoiceCreateSchema = z.object({
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  amount: z.number().nonnegative().optional(),
  linkedPoId: z.number().int().positive().optional(),
  linkedProcurementItemId: z.number().int().positive().optional(),
  status: z.enum(["captured", "submitted", "verified", "approved", "rejected"]).default("captured"),
  notes: z.string().optional(),
});

export const engineeringDesignCreateSchema = z.object({
  projectEngStageId: z.number().int().positive(),
  fileName: z.string().min(1),
  storageRef: z.string().min(1),
  notes: z.string().optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
});
export const engineeringDesignPatchSchema = engineeringDesignCreateSchema.partial().extend({ id: z.number().int().positive() });

export const qualityCheckCreateSchema = z.object({
  checklistId: z.number().int().positive(),
  templateItemId: z.number().int().positive(),
  qmStatus: z.string().optional(),
  approved: z.boolean().optional(),
  approvalComment: z.string().optional(),
});
export const qualityCheckPatchSchema = qualityCheckCreateSchema.partial().extend({ id: z.number().int().positive() });

export const financeVariationCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  expectedCost: z.number().nonnegative().default(0),
  priority: z.string().optional(),
});
export const financeVariationPatchSchema = financeVariationCreateSchema.partial().extend({ id: z.number().int().positive() });
