import { isApiError } from "@/lib/api-error";

interface Props {
  error: unknown;
}

/**
 * Renders a friendly inline alert for SharePoint write failures.
 *
 * Special cases the codes the document API surfaces when the integration
 * is half-configured:
 *   - DELEGATED_TOKEN_REQUIRED (HTTP 412) — the user hasn't completed MS SSO.
 *     We render a deep link to /api/auth/microsoft so they can reconnect in
 *     place rather than digging through nav.
 *   - ROOT_NOT_CONFIGURED (HTTP 409)  — the company or project SP root has
 *     no driveId yet. Point COO/CEO to the admin page that fixes it.
 *
 * Everything else falls back to the generic API error message.
 */
export function SharePointErrorAlert({ error }: Props) {
  if (!error) return null;

  const code: string | null = isApiError(error) ? error.code : null;
  const body = isApiError(error) ? (error.body as { nextAction?: string } | undefined) : undefined;
  const message = error instanceof Error ? error.message : "Something went wrong.";

  if (code === "DELEGATED_TOKEN_REQUIRED") {
    return (
      <div
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        role="alert"
        data-testid="sharepoint-reconnect-alert"
      >
        <p className="font-medium">Microsoft sign-in required</p>
        <p className="mt-1">{body?.nextAction ?? message}</p>
        <a
          href="/api/auth/microsoft"
          className="mt-2 inline-block font-medium text-emerald-700 hover:underline"
          data-testid="sharepoint-reconnect-link"
        >
          Sign in with Microsoft &rarr;
        </a>
      </div>
    );
  }

  if (code === "SHAREPOINT_UNAVAILABLE") {
    return (
      <div
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        role="alert"
        data-testid="sharepoint-unavailable-alert"
      >
        <p className="font-medium">SharePoint isn't connected</p>
        <p className="mt-1">{body?.nextAction ?? message}</p>
        <a
          href="/admin/document-management"
          className="mt-2 inline-block font-medium text-emerald-700 hover:underline"
          data-testid="sharepoint-connect-link"
        >
          Connect SharePoint &rarr;
        </a>
      </div>
    );
  }

  if (code === "ROOT_NOT_CONFIGURED") {
    return (
      <div
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        role="alert"
        data-testid="sharepoint-root-not-configured"
      >
        <p className="font-medium">SharePoint root not configured</p>
        <p className="mt-1">{body?.nextAction ?? message}</p>
        <a
          href="/admin/document-management"
          className="mt-2 inline-block font-medium text-emerald-700 hover:underline"
        >
          Configure roots &rarr;
        </a>
      </div>
    );
  }

  return <p className="text-xs text-destructive">{message}</p>;
}
