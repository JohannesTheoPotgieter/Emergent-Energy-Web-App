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
