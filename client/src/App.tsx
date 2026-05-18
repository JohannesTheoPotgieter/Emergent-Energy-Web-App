import { Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { LayoutModeProvider } from "@/hooks/use-layout-mode";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NetworkStatus } from "@/components/NetworkStatus";
import AppLayout from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/use-auth";
import { useAccessMatrix } from "@/hooks/use-access-matrix";
import { normalizeRoleForPermissions } from "@shared/schema";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { PAGE_REGISTRY, LEGACY_REDIRECTS } from "@/config/page-registry";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { LensProvider } from "@/hooks/use-lens-context";
import { Suspense, useEffect, useState } from "react";
import { useVersionCheck } from "@/hooks/use-version-check";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTE_COMPONENTS } from "@/config/route-components";
import { useScreenAvailability } from "@/hooks/use-screen-availability";

// Eagerly loaded pages (critical path — login, home, not-found)
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import MsCallbackPage from "@/pages/ms-callback";

type RouteConfig = { path: string; component?: React.ComponentType; redirectTo?: string };

const NAVIGATION_MODE = {
  desktop: "cockpit",
  mobile: "capture-check-approve-update-escalate",
} as const;

const APP_ROUTES: RouteConfig[] = [
  // Legacy redirects (old bookmarks / deep links)
  ...LEGACY_REDIRECTS.map((r) => ({ path: r.path, redirectTo: r.redirectTo })),
  // Active pages + registry-level redirects
  ...PAGE_REGISTRY.filter((page) => page.routeComponentKey || page.redirectTo).flatMap((page) => {
    const routes: RouteConfig[] = [];
    if (page.redirectTo) {
      routes.push({ path: page.path, redirectTo: page.redirectTo });
    } else if (page.routeComponentKey && ROUTE_COMPONENTS[page.routeComponentKey]) {
      routes.push({ path: page.path, component: ROUTE_COMPONENTS[page.routeComponentKey] });
    }

    for (const alias of page.aliases ?? []) {
      // Parametric aliases (e.g. /project/:projectName → /project/id/:projectId) can't
      // be redirected because the param names differ. Render the same component directly
      // — the page itself handles canonical-URL redirect once it resolves the identity.
      if (alias.includes(":") && page.routeComponentKey && ROUTE_COMPONENTS[page.routeComponentKey]) {
        routes.push({ path: alias, component: ROUTE_COMPONENTS[page.routeComponentKey] });
      } else {
        routes.push({ path: alias, redirectTo: page.path });
      }
    }

    return routes;
  }),
];


function AccessDenied() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-4">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-8 w-8 text-red-500" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
        <p className="text-sm text-muted-foreground">You don't have permission to view this page. Contact your administrator if you need access.</p>
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </a>
      </div>
    </div>
  );
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const navMode = isMobile ? NAVIGATION_MODE.mobile : NAVIGATION_MODE.desktop;

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const effectiveRole = normalizeRoleForPermissions(user?.role || companyRole);

  if (process.env.NODE_ENV !== "production") {
    (window as Window & { __navMode?: string }).__navMode = navMode;
  }

  const { canViewPath, loading: accessLoading, permissionsError, refetchPermissions } = useAccessMatrix();

  // Wait for the permissions matrix to finish loading before deciding the
  // user is denied — otherwise navigation flashes the "Access Denied" page
  // for ~200-500ms while /api/auth/permissions is still in flight, then
  // suddenly renders the real page. See user feedback 2026-04-21 on
  // /opportunities.
  //
  // EE-QA-019 — when the matrix query has errored, render an explicit
  // "permission service unavailable" retry banner instead of falling
  // through to the page (which previously rendered with an empty
  // permission map and looked like an inconsistent UI bug).
  if (effectiveRole && !accessLoading && permissionsError) {
    return <PermissionServiceError onRetry={() => void refetchPermissions()} />;
  }

  if (effectiveRole && !accessLoading && !canViewPath(location)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

function PermissionServiceError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-4" data-testid="permissions-service-error">
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Permission service unavailable</h2>
        <p className="text-sm text-muted-foreground">
          We could not load your access policy. Other parts of the app may show stale or
          missing data until this resolves. Try again, or contact your administrator if
          the problem persists.
        </p>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function usePageTitle(location: string) {
  useEffect(() => {
    const page = PAGE_REGISTRY.find((p) => p.path === location);
    const label = page?.label || "Dashboard";
    document.title = `${label} — Emergent Energy`;
  }, [location]);
}

// Map each route path to its PAGE_REGISTRY id, for screen-availability checks.
const PATH_TO_SCREEN_ID = new Map<string, string>(
  PAGE_REGISTRY.filter((p) => p.id && p.path).map((p) => [p.path, p.id]),
);

function ProtectedPages() {
  const [location] = useLocation();
  useScrollRestoration(location);
  usePageTitle(location);
  const { isScreenEnabled, isDegraded } = useScreenAvailability();

  return (
    <LensProvider>
    <RoleGuard>
    <AppLayout>
      {isDegraded && <ScreenAvailabilityWarning />}
      <ErrorBoundary>
      <Suspense fallback={<div className="space-y-6 p-6"><LoadingState variant="skeleton-card" cards={4} /><LoadingState variant="skeleton-table" rows={6} /></div>}>
      <div className="page-enter">
        <Switch>
          <Route path="/" component={HomePage} />
          {APP_ROUTES.map((route) => {
            if (route.redirectTo) {
              return <Route key={route.path} path={route.path}>{() => <Redirect to={route.redirectTo!} />}</Route>;
            }
            const PageComponent = route.component!;
            const screenId = PATH_TO_SCREEN_ID.get(route.path);
            return (
              <Route key={route.path} path={route.path}>
                {() => {
                  // Per COO spec (2026-05-11): disabled screens return 404, not
                  // a friendly "unavailable" page. Treat them as if they don't
                  // exist so bookmarks and deep links fail closed.
                  if (screenId && !isScreenEnabled(screenId)) return <NotFound />;
                  return <ErrorBoundary><PageComponent /></ErrorBoundary>;
                }}
              </Route>
            );
          })}
          <Route component={NotFound} />
        </Switch>
      </div>
      </Suspense>
      </ErrorBoundary>
    </AppLayout>
    </RoleGuard>
    </LensProvider>
  );
}

function ScreenAvailabilityWarning() {
  return (
    <div
      role="status"
      className="mx-auto mb-3 max-w-[1400px] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      data-testid="screen-availability-degraded"
    >
      Functionality Control status is temporarily unavailable. Screen visibility may be stale until the service recovers.
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/auth/login" component={LoginPage} />
      <Route path="/login">{() => <Redirect to="/auth/login" />}</Route>
      <Route path="/auth/ms-callback" component={MsCallbackPage} />
      <Route>
        <ProtectedRoute>
          <ProtectedPages />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

/**
 * Prompt 0.12: proactive "new version available" banner.
 *
 * Renders above all page content when useVersionCheck detects that the
 * server's /api/version has moved on from the build the tab bootstrapped
 * with. The user clicks Reload to pick up the new bundle — we never
 * auto-reload. They can also dismiss the banner, in which case it stays
 * hidden until the next polling cycle detects yet another newer build.
 */
function VersionUpdateBanner() {
  const { hasUpdate, latestBuild } = useVersionCheck();
  const [dismissedBuild, setDismissedBuild] = useState<string | null>(null);
  // Prompt 0.12 follow-up: NetworkStatus's offline banner uses z-[100] and
  // also position: fixed top-0. If both rendered simultaneously the version
  // banner would be obscured. Suppress the version banner while the tab is
  // offline — the user can't reload the bundle over a dead connection, so
  // offering the action is actively misleading. It will reappear once the
  // tab reconnects and the next useVersionCheck poll confirms the update.
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!hasUpdate || !latestBuild || dismissedBuild === latestBuild || !isOnline) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[90] bg-blue-600 text-white shadow-md"
      role="status"
      aria-live="polite"
      data-testid="version-update-banner"
    >
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-3">
        <Download className="h-4 w-4 shrink-0" />
        <p className="text-sm flex-1">
          A new version of Emergent Energy is available. Reload to pick up the latest updates.
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => window.location.reload()}
          data-testid="button-version-reload"
        >
          Reload
        </Button>
        <button
          type="button"
          onClick={() => setDismissedBuild(latestBuild)}
          className="text-white/80 hover:text-white"
          aria-label="Dismiss update notification"
          data-testid="button-version-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LayoutModeProvider>
          <AuthProvider>
            <VersionUpdateBanner />
            <NetworkStatus />
            <Router />
            <Toaster />
          </AuthProvider>
        </LayoutModeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
