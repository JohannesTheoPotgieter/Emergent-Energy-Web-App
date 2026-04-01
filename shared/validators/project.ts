import { z } from 'zod';

// Project status values based on opportunities.status in schema/projects.ts
const PROJECT_STATUSES = ['active', 'won', 'lost', 'on_hold', 'inactive'] as const;

export const CreateProjectSchema = z.object({
  projectName: z.string().min(1),
  clientId: z.number().int().positive().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  id: z.number().int().positive(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
