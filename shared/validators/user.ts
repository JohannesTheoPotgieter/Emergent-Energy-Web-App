import { z } from 'zod';
import { COMPANY_ROLES } from '../schema/users';

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(COMPANY_ROLES),
});

export const UpdateUserSchema = CreateUserSchema.partial().extend({
  id: z.number().int().positive(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
