import jwt from "jsonwebtoken";

const isStrictRuntime = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "12h";

if (isStrictRuntime && !JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in staging/production. Refusing to start with an unsafe default.");
}

const effectiveJwtSecret = JWT_SECRET || "emergent-energy-jwt-secret-2026";

export interface JWTPayload {
  userId: number;
  email: string;
  name: string;
  role: string;
}

export function generateToken(user: JWTPayload): string {
  return jwt.sign(user, effectiveJwtSecret, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, effectiveJwtSecret) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
