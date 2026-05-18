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

/** Minimal shape needed to read the session user off an Express request. */
interface RequestWithUser {
  user?: unknown;
}

export function getUserId(req: RequestWithUser): number | null {
  const user = req.user as AuthenticatedUser | undefined;
  return user?.id ?? null;
}

export function getUser(req: RequestWithUser): AuthenticatedUser | null {
  return (req.user as AuthenticatedUser) ?? null;
}
