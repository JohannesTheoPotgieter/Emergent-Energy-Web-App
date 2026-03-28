import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;   // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    // In dev/test without key: warn once and use a deterministic fallback
    // so the app starts, but tokens won't survive key rotation.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[TOKEN-ENC] TOKEN_ENCRYPTION_KEY not set — using insecure dev fallback. Set this env var before production deployment.");
      return crypto.scryptSync("dev-fallback-not-for-production", "salt", 32);
    }
    throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required in production.");
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  }
  return buf;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a string in the format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value previously encrypted with encryptToken.
 * Returns null if decryption fails (wrong key, tampered data, or unencrypted legacy value).
 */
export function decryptToken(stored: string): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  if (parts.length !== 3) {
    // Legacy plaintext value (not yet encrypted) — return as-is so the app
    // continues to function during migration, but log a warning.
    console.warn("[TOKEN-ENC] Encountered unencrypted token in database — re-encrypt on next token refresh.");
    return stored;
  }
  try {
    const key = getKey();
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const ciphertext = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    console.error("[TOKEN-ENC] Decryption failed — token may be corrupted or key has rotated.");
    return null;
  }
}
