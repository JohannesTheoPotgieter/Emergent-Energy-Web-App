import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Legacy NCR Dashboard — redirects to the main Quality Management page.
 *
 * This page previously showed NCR-specific charts (severity breakdown, aging,
 * opened/closed trend) but the backend dashboard endpoint does not return NCR
 * data, so the charts were always empty. The page-registry already redirects
 * /quality/dashboard → /quality, making this component unreachable via normal
 * navigation. Kept as a safe fallback redirect.
 */
export default function QualityDashboardPage() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/quality", { replace: true });
  }, [setLocation]);
  return null;
}
