# Microsoft Integrations

## Scope
The platform integrates with Microsoft 365 for authentication and collaboration surfaces.

## Core integration areas
- Azure AD sign-in and callback flow
- Outlook-related endpoints/workflows
- Teams-related endpoints/workflows
- SharePoint-connected operational surfaces where configured

## Operational guidance
- Keep integration routes behind explicit permission and auth checks.
- Treat Microsoft data as scoped to authenticated user/org context.
- Ensure failures are handled gracefully and logged for support diagnostics.

## SharePoint authentication — token sources

SharePoint **reads** (the document browser, folder listing/downloads, and the
auto Excel import) and SharePoint **writes** (upload/create-folder/rename/
check-in-out) use different Microsoft identities. They are configured
independently — one can work while the other is unconfigured.

### Reads + auto-import — app-only token (preferred)

`server/sharepoint-token.ts` resolves a Microsoft Graph token in this order:

1. **App-only (client-credentials) — preferred.** Set all three of
   `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`.
   The app then acquires its own Graph token (`acquireTokenByClientCredential`,
   scope `https://graph.microsoft.com/.default`). The token's permissions come
   from an Azure app **the tenant owns**, so SharePoint access no longer
   depends on a Replit connector's consented scopes.

   Required Azure setup (one-time): on that app registration, add Microsoft
   Graph **Application** permissions **`Sites.Read.All`** and
   **`Files.Read.All`** (add the `*.ReadWrite.All` variants only if app-only
   writes are later wired), then **Grant admin consent**. Add a client secret.
   You may reuse the `AZURE_*` sign-in app (just add the Application permission
   to it) or, preferred for least privilege, use a dedicated app.

2. **Replit connector (fallback).** When the `SHAREPOINT_*` vars are absent,
   the app falls back to the Replit `sharepoint` connector (or `outlook`, which
   must have `Sites.Read.All` + `Files.ReadWrite.All` granted at consent time).
   This keeps existing connector deployments working unchanged.

If a token lacks the SharePoint Graph permission, **Admin → SharePoint settings
→ Test Connection** reports `failureCategory: missing_scope`. The health check
accepts the permission whether it arrives as a delegated `scp` claim or an
app-only `roles` claim.

### Writes — per-user delegated SSO

Document writes use the signed-in user's delegated Microsoft token
(`server/ms-account-service.ts`, via the `AZURE_*` MSAL sign-in flow), so
SharePoint's own permission model and "modified by" attribution are respected.
A write by a user who has not completed Microsoft sign-in returns a 412.

### Mock mode

When MS Graph is unconfigured and `NODE_ENV !== "production"`, calls serve
fixtures (`server/lib/connector-mode.ts`, `isConnectorMocked("ms-graph")`).
MS Graph is treated as "live" when **either** the app-only vars **or** the
Replit connector are present.
