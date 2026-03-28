import React, { useState, useCallback, useEffect } from "react";
import { AdminPageShell } from "@/components/admin/admin-shell";
import { isSuperAdmin } from "@/lib/access-control";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Shield, Users, Eye, ScrollText } from "lucide-react";
import { RolesSection } from "./roles/roles-section";
import { UsersSection } from "./users/users-section";
import { VisibilitySection } from "./visibility/visibility-section";
import { AuditSection } from "./audit/audit-section";
import type { AdminSettingsSection } from "./settings-types";

const SETTINGS_NAV: Array<{ key: AdminSettingsSection; label: string; description: string; icon: React.ElementType }> = [
  { key: "roles", label: "Roles & Permissions", description: "Configure role access, navigation, and entity permissions", icon: Shield },
  { key: "users", label: "User Management", description: "Manage users, assign roles, and set overrides", icon: Users },
  { key: "visibility", label: "Visibility Config", description: "PD ticket and workstream visibility by role", icon: Eye },
  { key: "audit", label: "Audit Log", description: "Track permission changes and access events", icon: ScrollText },
];

function getInitialSection(): AdminSettingsSection {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  if (section && SETTINGS_NAV.some((n) => n.key === section)) return section as AdminSettingsSection;
  return "roles";
}

export default function AdminSettingsPage() {
  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  if (!isSuperAdmin(tokenRole, companyRole)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-12 px-16 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
            <p className="text-lg font-semibold">Access denied</p>
            <p className="text-sm text-muted-foreground mt-1">You don't have permission to manage roles.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AdminSettingsContent />;
}

function AdminSettingsContent() {
  const [activeSection, setActiveSection] = useState<AdminSettingsSection>(getInitialSection);

  const navigateSection = useCallback((section: AdminSettingsSection) => {
    setActiveSection(section);
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    const handlePopState = () => setActiveSection(getInitialSection());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <AdminPageShell
      surfaceId="roles"
      title="Admin Settings"
      description="Complete control over roles, permissions, user access, visibility, and audit trail — all from one trusted surface."
      statuses={[
        { label: "Backend enforcement aligned", tone: "success" },
        { label: "Role-aware administration", tone: "info" },
      ]}
    >
      <div className="flex gap-5" style={{ minHeight: "calc(100vh - 14rem)" }} data-testid="admin-roles-page">
        {/* Sidebar Navigation */}
        <div className="w-[220px] shrink-0 sticky top-4 self-start">
          <nav className="space-y-1">
            {SETTINGS_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => navigateSection(item.key)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-all group ${
                    isActive
                      ? "bg-emerald-50 border border-emerald-200 shadow-sm"
                      : "hover:bg-gray-50 border border-transparent"
                  }`}
                  data-testid={`settings-nav-${item.key}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
                      isActive ? "bg-emerald-100" : "bg-gray-100 group-hover:bg-gray-200"
                    }`}>
                      <Icon className={`h-3.5 w-3.5 ${isActive ? "text-emerald-600" : "text-gray-500"}`} />
                    </div>
                    <div className="min-w-0">
                      <span className={`text-sm font-semibold block ${isActive ? "text-emerald-900" : "text-gray-700"}`}>
                        {item.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-tight block">
                        {item.description}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          {activeSection === "roles" && <RolesSection />}
          {activeSection === "users" && <UsersSection />}
          {activeSection === "visibility" && <VisibilitySection />}
          {activeSection === "audit" && <AuditSection />}
        </div>
      </div>
    </AdminPageShell>
  );
}
