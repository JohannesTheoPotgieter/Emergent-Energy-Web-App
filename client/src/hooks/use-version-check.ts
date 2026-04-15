import { useEffect, useRef, useState } from "react";

/**
 * Prompt 0.12: proactive version check.
 *
 * Captures the deployed build identifier at first load and polls the
 * server's /api/version endpoint on an interval. When the server reports
 * a different build than the one the page was bootstrapped with, the hook
 * surfaces `hasUpdate: true` so the UI can show a banner inviting the
 * user to reload.
 *
 * This is the long-term mitigation for ChunkLoadError: users are told
 * about a new deployment *before* they navigate into a lazy route whose
 * old chunk hash no longer exists. Reloads are always user-initiated —
 * nothing auto-reloads behind the user's back so real bugs stay visible.
 */

interface VersionPayload {
  version?: string | null;
  buildTime?: string | null;
  buildId?: string | null;
  buildNumber?: string | null;
}

interface VersionCheckResult {
  hasUpdate: boolean;
  currentBuild: string | null;
  latestBuild: string | null;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function buildSignature(payload: VersionPayload | null | undefined): string | null {
  if (!payload) return null;
  // buildId is the strongest identifier; fall back to buildNumber or the
  // human-readable version. Any of these changing indicates a redeploy.
  const parts = [payload.buildId, payload.buildNumber, payload.version, payload.buildTime]
    .filter((part): part is string => typeof part === "string" && part.length > 0);
  if (parts.length === 0) return null;
  return parts.join("|");
}

async function fetchVersion(signal?: AbortSignal): Promise<VersionPayload | null> {
  try {
    const res = await fetch("/api/version", {
      method: "GET",
      credentials: "same-origin",
      signal,
      // Cache-bust to avoid a CDN/proxy pinning the first response for the
      // whole session — this poll is supposed to see fresh data.
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    return (await res.json()) as VersionPayload;
  } catch {
    // Transient network failures are silent — a later poll will succeed.
    return null;
  }
}

export function useVersionCheck(): VersionCheckResult {
  const [result, setResult] = useState<VersionCheckResult>({
    hasUpdate: false,
    currentBuild: null,
    latestBuild: null,
  });
  const initialBuildRef = useRef<string | null>(null);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const check = async () => {
      const payload = await fetchVersion(controller.signal);
      if (cancelled) return;
      const signature = buildSignature(payload);
      if (!signature) return;

      if (initialBuildRef.current === null) {
        initialBuildRef.current = signature;
        setResult({ hasUpdate: false, currentBuild: signature, latestBuild: signature });
        return;
      }

      if (signature !== initialBuildRef.current) {
        setResult({
          hasUpdate: true,
          currentBuild: initialBuildRef.current,
          latestBuild: signature,
        });
      }
    };

    void check();
    pollingRef.current = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  return result;
}
