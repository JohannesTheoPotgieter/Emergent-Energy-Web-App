/**
 * Express request type augmentation.
 * Eliminates the need for (req.user as any).id pattern.
 */

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: string;
  department?: string | null;
}

export function getUserId(req: any): number | null {
  const user = req.user as AuthenticatedUser | undefined;
  return user?.id ?? null;
}

export function getUser(req: any): AuthenticatedUser | null {
  return (req.user as AuthenticatedUser) ?? null;
}
