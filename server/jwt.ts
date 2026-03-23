import jwt from "jsonwebtoken";

const JWT_EXPIRES_IN = "12h";

function resolveJwtSecret(): string {
  const isStrictRuntime = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    if (isStrictRuntime) {
      throw new Error("JWT_SECRET must be set in staging/production.");
    }
    throw new Error("JWT_SECRET must be set in development. Configure local secret injection before starting the app.");
  }

  return jwtSecret;
}

export interface JWTPayload {
  userId: number;
  email: string;
  name: string;
  role: string;
  tokenVersion?: number;
  // TODO (Prompt 11): Future: include organizationId in JWT payload
  // and scope queries by req.user.organizationId in middleware.
  // See docs/spine-v2/08-org-scoping-plan.md for implementation plan.
}

export function generateToken(user: JWTPayload): string {
  return jwt.sign(user, resolveJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, resolveJwtSecret()) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
