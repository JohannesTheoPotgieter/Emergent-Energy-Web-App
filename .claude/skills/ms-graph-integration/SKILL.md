---
name: ms-graph-integration
description: Use when working on Microsoft 365 integrations — Outlook, SharePoint, Teams, Calendar, MSAL auth, or delta sync. Enforces the metadata-only rule (no email bodies / attachments in DB), the COO-only SharePoint sync gate, and the mock-connector-in-dev pattern.
---

# Microsoft 365 / Graph Integration

## Entry Points

| Concern                     | File                                     |
|-----------------------------|------------------------------------------|
| Graph client                | `server/ms-account-service.ts`           |
| Delta sync + subscriptions  | `server/ms-sync-service.ts`              |
| Sync routes                 | `server/ms-sync-routes.ts`               |
| MSAL auth                   | `server/microsoft-auth.ts`               |
| SharePoint list client      | `server/sharepoint-list.ts`              |
| SharePoint token cache      | `server/sharepoint-token.ts`             |
| SharePoint intake pipeline  | `server/intake-connector.ts`, `server/engineering-intake-routes.ts` |
| Outlook                     | `server/outlook.ts`                      |
| MS config                   | `server/ms-config.ts`                    |
| Microsoft integration routes| `server/microsoft-integration-enhancements-routes.ts` |

Dependencies: `@azure/msal-node`, `@azure/identity`, `@azure/keyvault-secrets`,
`@microsoft/microsoft-graph-client`.

## Hard Rules

1. **Metadata + deep links only.** NEVER store full email bodies, full message
   HTML, or attachment bytes in the database. Store the message ID, subject,
   sender, sent-at, and a Graph deep link. Attachments live in Outlook /
   SharePoint — link to them, don't copy them.

2. **SharePoint Engineering intake is COO-only, manual Pull/Push.**
   - Source list: Engineering Support → "Proposals Pipeline" SharePoint list
   - Sync is never automatic. The COO triggers Pull or Push explicitly.
   - Gate every sync endpoint with `requireRole(["COO_ADMIN"])` (use the
     canonical role value from `shared/schema/users.ts` `COMPANY_ROLES`).

3. **Mock connector for dev.** Graph tokens may be unavailable in dev /
   Replit environments. Use the mock connector path — don't hard-fail the
   server when MS creds are missing. Check existing code in
   `intake-connector.ts` for the pattern.

4. **Tokens are encrypted at rest.** See `server/lib/token-encryption.ts` and
   `server/secrets/`. Never log raw tokens. Never commit tokens.
   Production secrets come from Azure Key Vault (`@azure/keyvault-secrets`).

5. **Delta queries + catch-up.** Calendar + mail sync uses Graph delta
   tokens and subscriptions with a periodic catch-up pass in case subscriptions
   lapse. If you add a new sync surface, follow the pattern in
   `ms-sync-service.ts` — don't roll your own polling loop.

## Zod First

Validate every response field you consume from Graph with Zod before writing
to the DB. Microsoft changes response shapes silently; schema drift on the
Graph side has bitten us before (see `docs/dev-prod-compat-audit-2026-04-14.md`).

## Testing

- Unit tests should mock the Graph client, not the HTTP transport.
- Never run live Graph calls in CI — use the mock connector.
- Keep the token paths out of fixture files.
