# Data Encryption: Bank Details (POPIA Compliance)

## Overview

Counterparty bank account numbers and branch codes are encrypted at rest using
AES-256-GCM field-level encryption, implemented in `server/lib/field-encryption.ts`.

## Ciphertext Versioning

Encrypted values use a versioned format to support future key rotation:

```
v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
```

- **v1**: Current encryption version (AES-256-GCM, 12-byte IV, 16-byte auth tag)
- The version prefix allows future versions (v2, v3) to use different algorithms or
  keys without breaking decryption of existing data.

## Encryption Key

- Key source: `TOKEN_ENCRYPTION_KEY` environment variable
- Requirements: 32 bytes (64 hex chars or base64)
- Generate: `openssl rand -hex 32`
- This is the same key used for Microsoft token encryption (`server/utils/encryption.ts`)

## Rollout Order

### Phase 1: Write-path encryption (deployed first)
All new writes to `bankAccountNumber` and `bankBranchCode` go through `encryptField()`
before storage. Existing plaintext rows remain readable.

### Phase 2: Migrate existing data
Run: `npm run encrypt-bank-details`
This scans all counterparty rows, detects plaintext values, and encrypts them.
Already-encrypted values are skipped (idempotent).

### Phase 3: Read-path decryption
`decryptField()` is applied on read. It handles both encrypted and legacy
plaintext values safely (plaintext passes through unchanged).

## Affected Fields

| Table | Column | Location |
|-------|--------|----------|
| counterparties | bank_account_number | shared/schema/finance.ts |
| counterparties | bank_branch_code | shared/schema/finance.ts |

## Future Key Rotation

To rotate the encryption key:

1. Create a new key and set it as `TOKEN_ENCRYPTION_KEY_V2` (or similar)
2. Update `field-encryption.ts` to encrypt new values with `v2:` prefix using the new key
3. Decrypt reads by version: `v1:` uses old key, `v2:` uses new key
4. Run a re-encryption script that decrypts with old key and re-encrypts with new key
5. After all rows are re-encrypted to v2, retire the old key

## Security Notes

- Bank field values are **never logged** — not in audit logs, not in request/response logging
- The `encryptField()` function is **idempotent**: already-encrypted values are not double-encrypted
- The `decryptField()` function is **safe for mixed data**: plaintext values pass through unchanged
- Encryption happens at the application layer, not the database layer
