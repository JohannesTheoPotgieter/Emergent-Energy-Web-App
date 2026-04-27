// Roles & Permissions — Task #101.
//
// This is the SHELL that hosts the three-tab admin experience:
//
//   People    — pick a user, see "what they can do today" in plain English,
//               apply a template in one click.
//   Roles     — gallery of curated templates ("Engineer", "Project
//               Manager", "Finance Read-Only", …) with an apply preview.
//   Advanced  — the existing matrix (entity × role, user-overrides,
//               PD/visibility/audit-log) for power users. UNCHANGED.
//
// Route /admin/control-center now redirects here (handled in
// client/src/config/page-registry.ts).

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, Users, Sparkles, Settings2 } from "lucide-react";
import LegacyAdminRolesPage from "./admin-roles";
import { PeopleTab } from "./admin-roles/people-tab";
import { RolesTab } from "./admin-roles/roles-tab";

const TAB_KEYS = ["people", "roles", "advanced"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function readInitialTab(): TabKey {
  if (typeof window === "undefined") return "people";
  const url = new URL(window.location.href);
  const t = url.searchParams.get("tab");
  if (t && (TAB_KEYS as readonly string[]).includes(t)) return t as TabKey;
  return "people";
}

export default function AdminRolesShellPage() {
  const [tab, setTab] = useState<TabKey>(readInitialTab);

  function changeTab(next: string) {
    setTab(next as TabKey);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url.toString());
    }
  }

  return (
    <div className="space-y-6 p-6" data-testid="admin-roles-shell">
      <header className="flex items-start gap-3">
        <ShieldCheck className="h-7 w-7 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
          <p className="text-sm text-slate-600">
            Manage who can see and do what. Start with{" "}
            <span className="font-medium">People</span> for one-off changes,{" "}
            <span className="font-medium">Roles</span> for whole-team starter packs, or{" "}
            <span className="font-medium">Advanced</span> for the full matrix.{" "}
            <a
              href="/docs/permissions"
              className="text-emerald-700 underline-offset-2 hover:underline"
              data-testid="link-docs-permissions"
            >
              Read the COO/CEO guide
            </a>
            .
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList data-testid="tabs-admin-roles">
          <TabsTrigger value="people" data-testid="tab-people">
            <Users className="mr-2 h-4 w-4" /> People
          </TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-roles">
            <Sparkles className="mr-2 h-4 w-4" /> Roles
          </TabsTrigger>
          <TabsTrigger value="advanced" data-testid="tab-advanced">
            <Settings2 className="mr-2 h-4 w-4" /> Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-4">
          <PeopleTab />
        </TabsContent>
        <TabsContent value="roles" className="mt-4">
          <RolesTab />
        </TabsContent>
        <TabsContent value="advanced" className="mt-4">
          <LegacyAdminRolesPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
