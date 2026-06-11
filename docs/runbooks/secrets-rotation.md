# Secrets Rotation Runbook

**Owner:** Operations / Security
**Last reviewed:** 2026-04-12
**Related fix:** Audit finding A4 — committed secrets and weak placeholders.

This runbook tells you how to rotate every secret the Emergent Energy Web App
depends on, where each secret lives, and how to verify the rotation was
successful. It is the source of truth for "who owns which secret."

---

## 1. Inventory of secrets

| Secret | What it does | Where it lives | Rotation cadence |
|---|---|---|---|
| `SESSION_SECRET` | Signs the Express session cookie. Compromise = session hijack. | Replit Secrets Manager (prod), `.env` (dev only) | Every 90 days, or immediately on suspicion |
| `JWT_SECRET` | Signs JWT bearer tokens for API auth. | Replit Secrets Manager (prod) | Every 90 days |
| `TOKEN_ENCRYPTION_KEY` | Encrypts Microsoft tokens and bank-account fields at rest (AES-256, 32 bytes / 64 hex chars). | Replit Secrets Manager (prod) | Every 180 days. **Never lose this — it cannot be regenerated without re-encrypting all data.** |
| `DATABASE_URL` | PostgreSQL connection string. | Replit Secrets Manager (prod) — auto-injected by the Replit PostgreSQL module if used | Whenever DB credentials change |
| `AZURE_TENANT_ID` | Azure AD tenant identifier. **Not a secret** — public OAuth value. | `.replit` `[userenv.shared]` (safe to commit) | Never rotates |
| `AZURE_CLIENT_ID` | Azure AD application registration ID. **Not a secret**. | `.replit` `[userenv.shared]` (safe to commit) | Never rotates |
| `AZURE_CLIENT_SECRET` | Azure AD application secret (delegated SSO + Outlook/Teams via MS Graph). **THIS IS A SECRET.** | Azure Key Vault → Replit Secrets Manager | Every 180 days, or per Azure expiry |
| `SHAREPOINT_CLIENT_SECRET` | App-only SharePoint Graph app secret — the preferred SharePoint read / tracker-fetch path (falls back to the Replit connector if unset). **THIS IS A SECRET.** | Azure Key Vault → Replit Secrets Manager | Every 180 days, or per Azure expiry |
| `AZURE_CLIENT_SECRET_EXPIRES_ON` | Expiry **date** of `AZURE_CLIENT_SECRET` (ISO `YYYY-MM-DD`). **NOT a secret** — a plain date. Drives the COO's 30/7-day expiry alerts + the Connection Health countdown. | Replit Secrets / env (plain config) | **Set this to the new expiry every time `AZURE_CLIENT_SECRET` is rotated** |
| `SHAREPOINT_CLIENT_SECRET_EXPIRES_ON` | Expiry **date** of `SHAREPOINT_CLIENT_SECRET` (ISO `YYYY-MM-DD`). **NOT a secret.** Drives the SharePoint secret-expiry alerts + countdown. | Replit Secrets / env (plain config) | **Set this to the new expiry every time `SHAREPOINT_CLIENT_SECRET` is rotated** |
| `QM_ACCESS_CODE` | Shared access code for Quality Manager features. | Replit Secrets Manager (prod) | On every staff change in QM team |
| `EPM_ACCESS_CODE` | Shared access code for Engineering PM features. | Replit Secrets Manager (prod) | On every staff change in EPM team |
| `SEED_ADMIN_PASSWORD` | Default password for non-production seed users. Min 12 chars. | Replit Secrets Manager (dev/staging only) — must NOT exist in prod | Every staging refresh |
| `KEY_VAULT_URI` | Azure Key Vault endpoint URL. **Not a secret** but environment-specific. | Replit Secrets Manager | Only when Key Vault is moved |
| `PIPEDRIVE_API_TOKEN` | Pipedrive CRM API token. | Replit Secrets Manager | Every 180 days |
| `MICROSOFT_CONNECTOR_TOKEN` | Microsoft connector OAuth token. | Replit Secrets Manager | Per Replit connector lifecycle |
| `SENDGRID_API_KEY` | Outbound email API key (if email is enabled). | Replit Secrets Manager | Every 180 days |

---

## 2. Generating new secret values

For all symmetric secrets (`SESSION_SECRET`, `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`):

```bash
# 32-byte (256-bit) hex secret — use this format for all three
openssl rand -hex 32
```

For `SEED_ADMIN_PASSWORD` (must be >=12 chars):

```bash
openssl rand -base64 18
```

`AZURE_CLIENT_SECRET` is generated in the **Azure Portal**:
Azure Active Directory → App registrations → Emergent Energy → Certificates & secrets → New client secret.
Copy the value immediately — Azure only shows it once.

---

## 3. Rotation procedure (production)

Do these in order. Each step has a verification.

### Step 1 — Schedule a maintenance window
- Sessions will be invalidated after the SESSION_SECRET rotation. Tell users.
- JWT bearer tokens will be invalidated after the JWT_SECRET rotation.
- Plan ~10 min downtime for the restart.

### Step 2 — Generate new values
```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
# TOKEN_ENCRYPTION_KEY: ONLY rotate this if you have a re-encryption plan.
# It is used to encrypt at-rest data. Changing it requires decrypting with
# the OLD key and re-encrypting with the NEW key. See section 5.
```

### Step 3 — Set new values in Replit Secrets Manager
1. Open the Replit workspace.
2. Click **Tools → Secrets** (lock icon in the left sidebar).
3. For each secret in the inventory above, click the secret name and **Edit**, paste the new value, click **Save**.
4. Do NOT click "Add to .env" — that would re-create the committed-secret problem.

### Step 4 — Restart the app
- Click **Stop**, then **Run**, in the Replit workspace.
- Watch the boot log. You should see:
  ```
  [Secrets] (vault-loaded or env-loaded message)
  [Server] listening on port 5000
  ```
- If you see `[Secrets] Missing required runtime secrets: ...`, the rotation didn't take. Re-check Step 3.

### Step 5 — Verify
1. Open the app in a fresh incognito browser window.
2. Log in via Microsoft SSO. Verify you reach the dashboard.
3. Open a project, click on a financial tile. Verify data loads.
4. Open Replit logs and confirm no `[Auth] invalid signature` or `[Auth] token verification failed` errors are spamming.

### Step 6 — Audit log
1. Note the rotation date in `docs/runbooks/secrets-rotation-history.md` (create the file if it doesn't exist):
   ```
   ## 2026-04-12
   - Rotated: SESSION_SECRET, JWT_SECRET, QM_ACCESS_CODE
   - Operator: <name>
   - Reason: Audit finding A4 closeout
   - Verification: dashboard loaded, login OK, no auth errors in logs
   ```

---

## 4. Rotation procedure (development / Replit dev workspace)

Same procedure but you can be more relaxed about the maintenance window.
For dev, you may keep secrets in a local `.env` file — but `.env` MUST stay
in `.gitignore` and MUST never be committed.

To generate a fresh dev `.env`:
```bash
cat > .env <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
PORT=5000
NODE_ENV=development
EOF
```

---

## 5. Rotating `TOKEN_ENCRYPTION_KEY` safely

This key encrypts at-rest data. Rotating it requires re-encrypting:
1. Microsoft access/refresh tokens stored per user
2. Bank account fields on `counterparties`

**Procedure:**
1. Set `TOKEN_ENCRYPTION_KEY_OLD` to the current value in Replit Secrets.
2. Set `TOKEN_ENCRYPTION_KEY` to the new value.
3. Run the re-encryption script (one-off, must be added to `scripts/`):
   ```bash
   tsx scripts/rotate-token-encryption-key.ts
   ```
4. Verify with:
   ```bash
   tsx scripts/encrypt-existing-bank-details.ts --verify
   ```
5. Once verified, delete `TOKEN_ENCRYPTION_KEY_OLD` from Replit Secrets.

> ⚠️ If `scripts/rotate-token-encryption-key.ts` does not yet exist in the repo,
> do NOT rotate `TOKEN_ENCRYPTION_KEY` until it has been written and tested in
> staging. Losing this key means losing access to all encrypted-at-rest data.

---

## 5A. Reconnecting an integration after a credential lapses (the 15-minute task)

Tokens auto-refresh; the credentials that lapse on a fixed clock during a long
unattended period do **not** self-heal. The app counts each one down and pages
**COO_ADMIN** at **30 and 7 days** (and on expiry) via the in-app notification
inbox, and shows a live countdown on **Admin → Integration Statuses → Connection
Health**. When you get one of those alerts, this is the whole job. None of it is
a code change — it is an ops action.

### 5A.1 QuickBooks "Reconnect required" / refresh-token expiring (~2 min)

QuickBooks rotates its refresh token on use and hard-expires it ~100 days after
the last re-auth. If the app sits idle past that, or the connection is revoked
in Intuit, you'll get a **"Reconnect required: QuickBooks"** alert.

1. Open **Admin → QuickBooks** (or **Integration Statuses → Connection Health**).
2. Click **Reconnect QuickBooks** (this is the one-click `/api/quickbooks/auth`
   OAuth flow — admin only).
3. Approve the Intuit consent screen for the Emergent Energy company.
4. Verify the tile flips to **Connected** and "Last successful sync" updates.

No env changes — the new tokens are stored (encrypted) automatically. Until you
reconnect, finance pages keep showing the **last-good** reconciliation data with
an "as of \<timestamp\>" banner; they do not break.

### 5A.2 Azure / SharePoint client secret expiring (~15 min)

`AZURE_CLIENT_SECRET` (delegated SSO + Outlook/Teams) and
`SHAREPOINT_CLIENT_SECRET` (app-only SharePoint reads) are the credentials most
likely to lapse in a multi-month freeze. They are rotated in Azure, not in code.

1. **Generate a new secret** — Azure Portal → App registrations → *Emergent
   Energy* → **Certificates & secrets** → **New client secret**. Choose an
   expiry (e.g. 180 days) and **copy the value immediately** (Azure shows it once).
   Note the **expiry date** it displays.
2. **Update the secret** in Replit Secrets Manager (or Key Vault): set
   `AZURE_CLIENT_SECRET` (or `SHAREPOINT_CLIENT_SECRET`) to the new value.
3. **Update the expiry date** — set `AZURE_CLIENT_SECRET_EXPIRES_ON`
   (or `SHAREPOINT_CLIENT_SECRET_EXPIRES_ON`) to the new expiry as `YYYY-MM-DD`.
   This is what resets the countdown and silences the alert; **do not skip it**.
4. **Restart** the app (Stop → Run) so the new secret loads.
5. **Verify**: sign in via Microsoft SSO; open Integration Statuses → Connection
   Health and confirm the secret-expiry countdown now reads the new date and the
   "Reconnect required / Secret expiring" badge has cleared.

The 30/7-day alert dedup auto-resets once the expiry date moves forward, so the
next cycle alerts afresh. Until rotation, SharePoint/Outlook reads degrade to
last-imported tracker data rather than crashing.

---

## 6. What NOT to do

- **Never** commit a secret value to `.replit`, `.env`, `package.json`, source code, or any documentation file in the repo.
- **Never** paste a secret into a Slack/Teams channel, email, or chat tool. Use a password manager link or secure share.
- **Never** reuse a rotated secret value as a "new" rotation. Always generate fresh entropy.
- **Never** rotate `TOKEN_ENCRYPTION_KEY` without the re-encryption procedure in section 5.
- **Never** disable the `[Secrets] Missing required runtime secrets` boot guard. It exists to fail-fast when a misconfigured deploy would otherwise silently use insecure defaults.

---

## 7. Verification checklist (paste into the rotation ticket)

- [ ] Maintenance window scheduled and users notified
- [ ] New `SESSION_SECRET` generated and set in Replit Secrets
- [ ] New `JWT_SECRET` generated and set in Replit Secrets
- [ ] New `QM_ACCESS_CODE` generated and set in Replit Secrets
- [ ] New `EPM_ACCESS_CODE` generated and set in Replit Secrets (if applicable)
- [ ] `AZURE_CLIENT_SECRET` rotated in Azure Portal and updated in Replit Secrets
- [ ] `AZURE_CLIENT_SECRET_EXPIRES_ON` updated to the new expiry date (resets the alert/countdown)
- [ ] `SHAREPOINT_CLIENT_SECRET` rotated + `SHAREPOINT_CLIENT_SECRET_EXPIRES_ON` updated (if the app-only SharePoint app is in use)
- [ ] Connection Health tile shows the new secret-expiry countdown and no "Reconnect required" badge
- [ ] App restarted without `[Secrets] Missing required runtime secrets` error
- [ ] Microsoft SSO login verified end-to-end
- [ ] Dashboard loads with financial data
- [ ] No `[Auth] invalid signature` errors in logs for 10 minutes after restart
- [ ] Rotation history logged in `docs/runbooks/secrets-rotation-history.md`

---

## 8. References

- `server/secrets/vault.ts` — secret loader and Key Vault client
- `server/bootstrap/security-middleware.ts` — session and rate-limit configuration
- `.env.example` — full list of environment variables and their purpose
- Audit finding A4 in `docs/full-stack-audit-2026-04-12.md` (if produced)
