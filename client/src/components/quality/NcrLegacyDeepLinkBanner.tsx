import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, XCircle } from "lucide-react";

async function fetchNcr(id: number): Promise<{ ncr: any }> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/quality/ncrs/${id}`, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch NCR (${res.status})`);
  return res.json();
}

/**
 * Surfaces a banner on the Quality dashboard when the user arrived via a
 * legacy NCR deep link (`/quality/ncr/:id` → `/quality?ncr=<id>`). Without
 * this, the legacy redirect lost the id and stranded the user on the
 * dashboard top with no obvious next step.
 */
export function NcrLegacyDeepLinkBanner() {
  const [dismissed, setDismissed] = useState(false);
  const ncrId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("ncr");
    return v && /^\d+$/.test(v) ? Number(v) : null;
  }, []);

  const { data, isError } = useQuery<{ ncr: any }>({
    queryKey: ["quality-ncr-detail", ncrId],
    queryFn: () => fetchNcr(ncrId as number),
    enabled: ncrId !== null && !dismissed,
    retry: false,
  });

  if (ncrId === null || dismissed) return null;
  const ncr = data?.ncr;

  return (
    <div
      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-900 flex items-start gap-2"
      role="status"
      data-testid="banner-ncr-deep-link"
    >
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        {isError ? (
          <p>You followed a legacy NCR link for <strong>NCR #{ncrId}</strong>, but it could not be loaded. The NCR may have been deleted or moved.</p>
        ) : ncr ? (
          <p>
            Direct link to <strong>NCR #{ncrId}</strong>
            {ncr.title ? <> — {ncr.title}</> : null}
            {ncr.severity ? <> · severity: {ncr.severity}</> : null}
            {ncr.status ? <> · status: {ncr.status}</> : null}
            {ncr.project_name ? <> · project: {ncr.project_name}</> : null}
            . Open the project's Quality tab below to view the full record.
          </p>
        ) : (
          <p>Loading NCR <strong>#{ncrId}</strong> from the legacy link…</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-blue-900/70 hover:text-blue-900 shrink-0"
        aria-label="Dismiss NCR notice"
        data-testid="btn-dismiss-ncr-banner"
      >
        <XCircle className="h-4 w-4" />
      </button>
    </div>
  );
}
