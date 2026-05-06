# Centralized Secrets Vault Migration Plan

## Target architecture
- **Vault per environment**: `kv-emergent-dev`, `kv-emergent-stg`, `kv-emergent-prd`.
- **Application runtime**: services authenticate with managed identity / workload identity and read only required secret names from the environment-specific vault.
- **CI/CD runtime**: pipeline identity reads deployment-only secrets and writes no secret values to logs.
- **Human access**: admin groups have write rotation rights; developers have no direct production read.
- **Auditability**: vault diagnostic logs and access logs flow to SIEM with alerting for denied/unknown principal access.

## Secrets inventory categories
1. Database credentials (`DATABASE_URL`, read-only replicas, migration credentials).
2. API keys (email provider, integrations).
3. OAuth and identity credentials (`AZURE_CLIENT_SECRET`, app registrations).
4. Microsoft/Outlook integration tokens and connector secrets.
5. Third-party service credentials and per-environment service tokens.
6. Session and signing secrets (`SESSION_SECRET`, `JWT_SECRET`).

## Naming convention
- Pattern: `<app>-<domain>-<credential>-<env>` (example: `ee-app-jwt-signing-secret-prd`).
- Short aliases inside app mapping are stable (`app-jwt-signing-secret`) while vault instance separates env.
- Secret metadata tags required: `owner`, `system`, `rotation_days`, `criticality`, `last_rotated_by`.

## Access model
- **Service identities**
  - `mi-ee-web-dev` → read `dev` vault only.
  - `mi-ee-web-stg` → read `stg` vault only.
  - `mi-ee-web-prd` → read `prd` vault only.
  - `mi-ee-ci` → read deploy-time secrets only (no app runtime secrets except deployment dependencies).
- **Human groups**
  - `EE-KeyVault-Admins`: create/update/delete secrets, approve emergency break-glass.
  - `EE-KeyVault-Readers-NonProd`: read dev/stg only for troubleshooting.
  - No direct human read on production secrets outside break-glass runbook.
- **Least privilege controls**
  - Key Vault RBAC with scope restricted to per-environment vault.
  - CI/CD service principal only granted `secrets/get` and, when required, `secrets/list`.

## Migration plan
1. **Inventory and classify** all current secrets by owner, environment, and rotation urgency.
2. **Create vaults and RBAC bindings** for dev/stg/prd.
3. **Preload secrets** in each vault using naming convention and metadata tags.
4. **Enable app vault bootstrap** (`KEY_VAULT_URI` + managed identity auth).
5. **Deploy to dev**, validate startup and auth flows.
6. **Deploy to staging**, run smoke and integration tests.
7. **Production cutover** during maintenance window.
8. **Decommission legacy secret stores** (shared docs/spreadsheets/local files).

## Rotation checklist
### Rotate immediately
- Session signing and JWT secrets.
- Database credentials that were historically shared.
- OAuth client secrets used across teams/files.
- Any integration token found in old docs or config commits.

### Rotate in scheduled wave
- Low-risk service tokens confirmed never exposed.
- Non-production-only integration secrets.

### Rotation process
1. Create new vault version.
2. Validate read access from service identity.
3. Restart or recycle workload to refresh in-memory config.
4. Run smoke checks.
5. Revoke prior credential/version according to provider policy.
6. Record evidence in change log and SIEM ticket.

## Rollback plan
- Keep previous secret version active until post-deploy validation passes.
- If vault integration fails:
  1. Abort deployment.
  2. Roll back to previous app revision.
  3. Re-point workload to previous known-good vault URI/version policy.
  4. Keep logs scrubbed; never print secret payloads.
- Break-glass access requires dual approval and incident record.

## Developer and CI/CD guidance
- Local dev obtains secrets via personal identity against **dev vault**; no shared plaintext files.
- `.env` files may only hold non-secret toggles and local runtime flags.
- CI/CD must use federated identity/OIDC instead of long-lived pipeline secrets.
- Pipeline steps must avoid `echo` of secret-bearing env vars and enforce masked logging.

## Validation and testing plan
- Startup test: app boots with vault-fed secrets.
- Negative test: missing required secret causes clear startup failure without secret value leakage.
- IAM test: service identity can read only its environment secrets.
- Environment separation test: dev identity denied from staging/prod vault.
- Rotation test: update secret value/version in vault; app continues without code changes.

## Onboarding (admins/devops)
1. Add user to least-privilege admin group.
2. Complete rotation and incident-response runbook training.
3. Validate access via audited non-production read test.
4. Document ownership for each secret domain.
