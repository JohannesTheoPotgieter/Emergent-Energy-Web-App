/**
 * Field-level encryption for POPIA-sensitive data (bank details, etc.)
 *
 * Uses AES-256-GCM with versioned ciphertext format for future key rotation:
 *   v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 *
 * Key source: TOKEN_ENCRYPTION_KEY environment variable (same key used for
 * Microsoft token encryption in server/utils/encryption.ts — the approved
 * project standard for application-level encryption).
 *
 * IMPORTANT:
 * - Never log plaintext or decrypted banking values.
 * - Functions are idempotent: already-encrypted values are not double-encrypted.
 * - null/undefined inputs pass through unchanged.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const CURRENT_VERSION = "v1";
const VERSION_PREFIX = `${CURRENT_VERSION}:`;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is required for field-level encryption. " +
      "Generate with: openssl rand -hex 32"
    );
  }

  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const asBuffer = Buffer.from(raw, "base64");
  if (asBuffer.length === 32) return asBuffer;

  throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex chars");
}

/**
 * Returns true if the value looks like our versioned encrypted format.
 * Used to prevent double-encryption.
 */
export function isFieldEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!value.startsWith(VERSION_PREFIX)) return false;
  const parts = value.split(":");
  // v1:<iv>:<authTag>:<ciphertext> = 4 parts
  return parts.length === 4;
}

/**
 * Encrypt a plaintext value. Returns versioned ciphertext: v1:<iv>:<authTag>:<ciphertext>
 *
 * Idempotent: if the value is already encrypted, returns it unchanged.
 * Null/undefined pass through unchanged.
 */
export function encryptField(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext === null) return null;
  if (plaintext === undefined) return undefined;
  if (plaintext === "") return "";

  // Idempotent: don't double-encrypt
  if (isFieldEncrypted(plaintext)) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${CURRENT_VERSION}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a versioned ciphertext value. Returns the original plaintext.
 *
 * If the value is not in encrypted format (e.g. legacy plaintext), returns it as-is.
 * This allows safe read-path activation before all rows are migrated.
 * Null/undefined pass through unchanged.
 */
export function decryptField(ciphertext: string | null | undefined): string | null | undefined {
  if (ciphertext === null) return null;
  if (ciphertext === undefined) return undefined;
  if (ciphertext === "") return "";

  // Not encrypted (legacy plaintext) — return as-is for safe gradual rollout
  if (!isFieldEncrypted(ciphertext)) return ciphertext;

  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");

  if (version !== CURRENT_VERSION) {
    // Future: handle v2, v3 key rotation versions here
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
