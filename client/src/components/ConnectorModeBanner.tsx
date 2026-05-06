import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

type ConnectorStatus = {
  env: string;
  msGraph: "live" | "mock";
  quickbooks: "live" | "mock";
  pipedrive: "live" | "mock";
  anyMock: boolean;
};

/**
 * EE-QA-016 — visible signal whenever any external connector is serving
 * fixture data instead of hitting the real API. The mock-mode gate itself
 * lives in `server/lib/connector-mode.ts` and is hard-locked off in
 * production, so this banner can never appear in prod regardless of the
 * NODE_ENV the client thinks it is in.
 */
export function ConnectorModeBanner() {
  const { data } = useQuery<ConnectorStatus>({
    queryKey: ["/api/platform/connector-status"],
    queryFn: async () => {
      const res = await fetch("/api/platform/connector-status", { credentials: "include" });
      if (!res.ok) throw new Error("status fetch failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (!data || !data.anyMock || data.env === "production") return null;

  const mocked = [
    data.msGraph === "mock" ? "Microsoft 365" : null,
    data.quickbooks === "mock" ? "QuickBooks" : null,
    data.pipedrive === "mock" ? "Pipedrive" : null,
  ].filter(Boolean);

  return (
    <div
      role="status"
      data-testid="connector-mode-banner"
      className="border-b border-amber-300 bg-amber-50 text-amber-900 text-xs px-4 py-1.5 flex items-center gap-2"
    >
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span>
        <strong>Fixture data:</strong> {mocked.join(", ")}{" "}
        {mocked.length === 1 ? "is" : "are"} returning seeded fixtures, not real
        records. Set the corresponding credentials (or
        <code className="px-1 mx-1 bg-amber-100 rounded">USE_MOCK_CONNECTORS=false</code>)
        to switch to the live API.
      </span>
    </div>
  );
}
