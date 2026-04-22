import React, { useState, useCallback, useEffect } from "react";
import { AdminPageShell } from "@/components/admin/admin-shell";
import { isSuperAdmin } from "@/lib/access-control";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, MonitorOff, Shield, Users, Eye, ScrollText } from "lucide-react";
import { RolesSection } from "./roles/roles-section";
import { UsersSection } from "./users/users-section";
import { VisibilitySection } from "./visibility/visibility-section";
import { AuditSection } from "./audit/audit-section";
import { ScreensSection } from "./screens/screens-section";
import type { AdminSettingsSection } from "./settings-types";

const SETTINGS_NAV: Array<{ key: AdminSettingsSection; label: string; icon: React.ElementType }> = [
  { key: "roles", label: "Roles & Permissions", icon: Shield },
  { key: "users", label: "Users", icon: Users },
  { key: "visibility", label: "Visibility", icon: Eye },
  { key: "screens", label: "Screen Availability", icon: MonitorOff },
  { key: "audit", label: "Audit Log", icon: ScrollText },
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
      description="Roles, permissions, users, and visibility."
      statuses={[
        { label: "Backend enforcement aligned", tone: "success" },
      ]}
    >
      <div data-testid="admin-roles-page">
        {/* Compact top pill navigation */}
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200 pb-3">
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigateSection(item.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isActive
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                data-testid={`settings-nav-${item.key}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Content Area — full width */}
        <div className="min-w-0">
          {activeSection === "roles" && <RolesSection />}
          {activeSection === "users" && <UsersSection />}
          {activeSection === "visibility" && <VisibilitySection />}
          {activeSection === "screens" && <ScreensSection />}
          {activeSection === "audit" && <AuditSection />}
        </div>
      </div>
    </AdminPageShell>
  );
}
