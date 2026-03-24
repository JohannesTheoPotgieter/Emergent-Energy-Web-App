import { z } from 'zod';

export const CreateTaskSchema = z.object({
  title: z.string().min(1),
  projectId: z.number().int().positive(),
  status: z.string().min(1).optional(),
  assigneeId: z.number().int().positive().optional(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  id: z.number().int().positive(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
