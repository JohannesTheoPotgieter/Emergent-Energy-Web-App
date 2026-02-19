import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "emergent-energy-jwt-secret-2026";
const JWT_EXPIRES_IN = "12h";

export interface JWTPayload {
  userId: number;
  email: string;
  name: string;
  role: string;
}

export function generateToken(user: JWTPayload): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
