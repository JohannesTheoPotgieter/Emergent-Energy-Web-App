import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to encrypt/decrypt Microsoft tokens");
  }

  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const asBuffer = Buffer.from(raw, "base64");
  if (asBuffer.length === 32) return asBuffer;

  throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex chars");
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function isEncryptedPayload(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.split(":").length === 3;
}
