import { Switch, Route, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
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
import { PAGE_REGISTRY, ROLE_LANDING_PAGE } from "@/config/page-registry";
import { buildRoutePlan } from "@/config/app-route-plan";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { LensProvider } from "@/hooks/use-lens-context";
import { Suspense, useEffect } from "react";

// Eagerly loaded pages (critical path — login, home, not-found)
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import MsCallbackPage from "@/pages/ms-callback";
import { ROUTE_COMPONENTS, ROUTE_COMPONENT_KEYS } from "@/config/route-components";

type RouteConfig = { path: string; component?: React.ComponentType<any>; redirectTo?: string };

const NAVIGATION_MODE = {
  desktop: "cockpit",
  mobile: "capture-check-approve-update-escalate",
} as const;

function resolveHomePath(userRole?: string | null, companyRole?: string | null) {
  const effectiveRole = normalizeRoleForPermissions(userRole || companyRole);
  // Fallback to "/" (home) instead of "/dashboard" (→ /gates) since /gates requires
  // lifecycle view permission that not all roles have (ENGINEER, ACCOUNTANT).
  return ROLE_LANDING_PAGE[effectiveRole] || "/";
}

function HomeRedirect() {
  const { user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  return <Redirect to={resolveHomePath(user?.role, companyRole)} />;
}

const { entries: APP_ROUTE_PLAN, unresolvedComponentKeys } = buildRoutePlan(ROUTE_COMPONENT_KEYS);

if (unresolvedComponentKeys.length > 0) {
  throw new Error(`Unresolved route component keys: ${unresolvedComponentKeys.join(", ")}`);
}

const APP_ROUTES: RouteConfig[] = APP_ROUTE_PLAN.map((route) => ({
  path: route.path,
  redirectTo: route.redirectTo,
  component: route.routeComponentKey ? ROUTE_COMPONENTS[route.routeComponentKey] : undefined,
}));


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
    (window as any).__navMode = navMode;
  }

  const { canViewPath } = useAccessMatrix();

  if (effectiveRole && !canViewPath(location)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

/** Redirect that preserves query parameters from the current URL */
function RedirectPreserveQuery({ to }: { to: string }) {
  const targetHasQuery = to.includes("?");
  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  // If target already has query params, append current ones with &; otherwise use ?
  const dest = currentSearch && !targetHasQuery
    ? `${to}${currentSearch}`
    : currentSearch && targetHasQuery
      ? `${to}${currentSearch.replace("?", "&")}`
      : to;
  return <Redirect to={dest} />;
}

function usePageTitle(location: string) {
  useEffect(() => {
    const page = PAGE_REGISTRY.find((p) => p.path === location);
    const label = page?.label || "Dashboard";
    document.title = `${label} — Emergent Energy`;
  }, [location]);
}

function ProtectedPages() {
  const [location] = useLocation();
  useScrollRestoration(location);
  usePageTitle(location);

  return (
    <LensProvider>
    <RoleGuard>
    <AppLayout>
      <ErrorBoundary>
      <Suspense fallback={<div className="space-y-6 p-6"><LoadingState variant="skeleton-card" cards={4} /><LoadingState variant="skeleton-table" rows={6} /></div>}>
      <div className="page-enter">
        <Switch>
          <Route path="/" component={HomePage} />
          {APP_ROUTES.map((route) => {
            if (route.redirectTo) {
              return <Route key={route.path} path={route.path}>{() => <RedirectPreserveQuery to={route.redirectTo!} />}</Route>;
            }
            return <Route key={route.path} path={route.path} component={route.component!} />;
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

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NetworkStatus />
          <Router />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
