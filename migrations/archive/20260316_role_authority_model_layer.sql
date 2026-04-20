-- Migration-safe authority layer: additive only, does not change existing auth behavior.
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS authority_model jsonb;

-- Optional: ensure deterministic object shape for easier auditing and API responses.
UPDATE role_permissions
SET authority_model = COALESCE(authority_model, jsonb_build_object('templateKey', 'legacy-compat', 'rules', jsonb_build_object()))
WHERE authority_model IS NULL;
