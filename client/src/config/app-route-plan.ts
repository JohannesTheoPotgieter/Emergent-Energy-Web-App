import { LEGACY_REDIRECTS, PAGE_REGISTRY } from "@/config/page-registry";

export type RoutePlanEntry = {
  path: string;
  routeType: "page" | "alias" | "legacy-redirect";
  routeComponentKey?: string;
  redirectTo?: string;
};

export function buildRoutePlan(availableRouteComponentKeys: readonly string[]) {
  const available = new Set(availableRouteComponentKeys);
  const entries: RoutePlanEntry[] = [];
  const unresolvedComponentKeys: string[] = [];

  for (const redirect of LEGACY_REDIRECTS) {
    entries.push({
      path: redirect.path,
      routeType: "legacy-redirect",
      redirectTo: redirect.redirectTo,
    });
  }

  for (const page of PAGE_REGISTRY) {
    if (page.redirectTo) {
      entries.push({
        path: page.path,
        routeType: "alias",
        redirectTo: page.redirectTo,
      });
    } else if (page.routeComponentKey) {
      if (!available.has(page.routeComponentKey)) {
        unresolvedComponentKeys.push(page.routeComponentKey);
      } else {
        entries.push({
          path: page.path,
          routeType: "page",
          routeComponentKey: page.routeComponentKey,
        });
      }
    }

    for (const alias of page.aliases ?? []) {
      entries.push({
        path: alias,
        routeType: "alias",
        redirectTo: page.path,
      });
    }
  }

  return {
    entries,
    unresolvedComponentKeys,
  };
}
