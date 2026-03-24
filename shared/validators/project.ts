import { z } from 'zod';

export const CreateProjectSchema = z.object({
  projectName: z.string().min(1),
  clientId: z.number().int().positive().optional(),
  status: z.string().min(1).optional(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  id: z.number().int().positive(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
