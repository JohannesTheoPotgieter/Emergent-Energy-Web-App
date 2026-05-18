import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Set a test encryption key before importing the module
process.env.TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { encryptField, decryptField, isFieldEncrypted } from "../../../server/lib/field-encryption";

describe("field-encryption (AES-256-GCM, versioned)", () => {
  // ── Encrypt/Decrypt round-trip ──

  it("encrypts and decrypts a bank account number correctly", () => {
    const plaintext = "1234567890";
    const encrypted = encryptField(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toMatch(/^v1:/);
    expect(decryptField(encrypted)).toBe(plaintext);
  });

  it("encrypts and decrypts a bank branch code correctly", () => {
    const plaintext = "250655";
    const encrypted = encryptField(plaintext);

    expect(decryptField(encrypted)).toBe(plaintext);
  });

  // ── Raw DB value is not plaintext ──

  it("encrypted value does not contain the original plaintext", () => {
    const plaintext = "9876543210";
    const encrypted = encryptField(plaintext)!;

    expect(encrypted).not.toContain(plaintext);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted.split(":").length).toBe(4);
  });

  // ── Idempotent: no double-encryption ──

  it("does not double-encrypt an already encrypted value", () => {
    const plaintext = "1234567890";
    const encrypted1 = encryptField(plaintext);
    const encrypted2 = encryptField(encrypted1);

    // Should return the same encrypted value unchanged
    expect(encrypted2).toBe(encrypted1);
    expect(decryptField(encrypted2)).toBe(plaintext);
  });

  // ── Null/undefined handling ──

  it("returns null for null input", () => {
    expect(encryptField(null)).toBeNull();
    expect(decryptField(null)).toBeNull();
  });

  it("returns undefined for undefined input", () => {
    expect(encryptField(undefined)).toBeUndefined();
    expect(decryptField(undefined)).toBeUndefined();
  });

  it("returns empty string for empty string input", () => {
    expect(encryptField("")).toBe("");
    expect(decryptField("")).toBe("");
  });

  // ── isFieldEncrypted detection ──

  it("detects encrypted values correctly", () => {
    const encrypted = encryptField("test123");
    expect(isFieldEncrypted(encrypted)).toBe(true);
  });

  it("detects plaintext values as not encrypted", () => {
    expect(isFieldEncrypted("1234567890")).toBe(false);
    expect(isFieldEncrypted("250655")).toBe(false);
    expect(isFieldEncrypted(null)).toBe(false);
    expect(isFieldEncrypted(undefined)).toBe(false);
    expect(isFieldEncrypted("")).toBe(false);
  });

  // ── Legacy plaintext pass-through on decrypt ──

  it("decryptField returns plaintext as-is for unencrypted legacy values", () => {
    expect(decryptField("1234567890")).toBe("1234567890");
    expect(decryptField("250655")).toBe("250655");
  });

  // ── Versioned format ──

  it("encrypted format starts with v1: version prefix", () => {
    const encrypted = encryptField("test")!;
    expect(encrypted.startsWith("v1:")).toBe(true);
  });

  it("encrypted format has 4 colon-separated parts", () => {
    const encrypted = encryptField("test")!;
    const parts = encrypted.split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("v1");
  });

  // ── Different encryptions produce different ciphertexts (random IV) ──

  it("encrypting the same value twice produces different ciphertexts", () => {
    const a = encryptField("same_value");
    const b = encryptField("same_value");
    expect(a).not.toBe(b); // Different random IVs
    expect(decryptField(a)).toBe("same_value");
    expect(decryptField(b)).toBe("same_value");
  });

  // ── Schema comments present ──

  it("schema has encryption comments on bank fields", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "shared/schema/finance.ts"), "utf8");
    expect(schema).toContain("stored encrypted at rest; decrypt only in server/lib/field-encryption.ts");
  });

  // ── Write paths use encrypt ──

  it("subcontractor routes use encryptField on write paths", () => {
    const routes = fs.readFileSync(path.join(process.cwd(), "server/subcontractor-routes.ts"), "utf8");
    expect(routes).toContain("encryptField(bankAccountNumber)");
    expect(routes).toContain("encryptField(bankBranchCode)");
  });

  // ── Read paths use decrypt ──

  it("subcontractor routes use decryptField on read paths", () => {
    const routes = fs.readFileSync(path.join(process.cwd(), "server/subcontractor-routes.ts"), "utf8");
    expect(routes).toContain("decryptField(row.bank_account_number");
    expect(routes).toContain("decryptField(row.bank_branch_code");
  });
});
