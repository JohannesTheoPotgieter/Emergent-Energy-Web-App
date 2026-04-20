-- Security fix: drop plaintext password column from role_credentials
-- The last_password_plain column stored plaintext passwords which is a critical security risk.
ALTER TABLE "role_credentials" DROP COLUMN IF EXISTS "last_password_plain";
