/**
 * Smart Import "friendly setup" hooks — import status, attention queue,
 * learned mapping profiles + rules, project bindings, and Teams alert
 * settings.
 *
 * Backed by the import-config + import-status API surface (all gated on the
 * `smart_import` permission — view to read, edit to mutate).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

// =========================================================================
// Shared view types
// =========================================================================

export type ImportState =
  | "up_to_date"
  | "needs_review"
  | "failed"
  | "in_progress";

export interface ImportStatusView {
  runId: number;
  projectId: number | null;
  projectName: string;
  sourceFileName: string;
  state: ImportState;
  status: string;
  lastImportedAt: string | null;
  recordsChanged: number | null;
  reason: string | null;
}

// =========================================================================
// Per-project import status
// =========================================================================

interface ImportStatusResponse {
  projectId: number;
  latest: ImportStatusView | null;
}

export function useProjectImportStatus(projectId: number | null) {
  return useQuery<ImportStatusResponse>({
    queryKey: projectId
      ? [`/api/projects/${projectId}/import-status`]
      : ["/api/projects/0/import-status"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: typeof projectId === "number" && projectId > 0,
  });
}

// =========================================================================
// Imports needing attention
// =========================================================================

interface AttentionResponse {
  items: ImportStatusView[];
}

const ATTENTION_KEY = ["/api/import-config/attention"] as const;

export function useImportsNeedingAttention(enabled = true) {
  return useQuery<AttentionResponse>({
    queryKey: ATTENTION_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

// =========================================================================
// Learned mapping profiles + rules
// =========================================================================

export interface ImportProfile {
  id: number;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  ruleCount: number;
}

interface ProfilesResponse {
  profiles: ImportProfile[];
}

const PROFILES_KEY = ["/api/import-config/profiles"] as const;

export function useImportProfiles(enabled = true) {
  return useQuery<ProfilesResponse>({
    queryKey: PROFILES_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

export interface ImportRule {
  id: number;
  templateProfileId: number;
  section: string;
  sourceHeader: string;
  canonicalField: string;
  confidenceWeight: number;
  createdAt: string;
}

interface RulesResponse {
  profileId: number;
  rules: ImportRule[];
}

export function profileRulesKey(profileId: number) {
  return [`/api/import-config/profiles/${profileId}/rules`] as const;
}

export function useProfileRules(profileId: number | null, enabled = true) {
  return useQuery<RulesResponse>({
    queryKey: profileId
      ? profileRulesKey(profileId)
      : ["/api/import-config/profiles/0/rules"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: enabled && typeof profileId === "number" && profileId > 0,
  });
}

export interface UpdateRulePayload {
  canonicalField?: string;
  confidenceWeight?: number;
}

export function useUpdateImportRule() {
  const qc = useQueryClient();
  return useMutation<
    { rule: ImportRule },
    Error,
    { id: number; profileId: number; patch: UpdateRulePayload }
  >({
    mutationFn: async ({ id, patch }) => {
      const res = await apiRequest("PATCH", `/api/import-config/rules/${id}`, patch);
      return res.json();
    },
    onSuccess: (_data, { profileId }) => {
      qc.invalidateQueries({ queryKey: profileRulesKey(profileId) });
    },
  });
}

export function useDeleteImportRule() {
  const qc = useQueryClient();
  return useMutation<
    { success: true },
    Error,
    { id: number; profileId: number }
  >({
    mutationFn: async ({ id }) => {
      const res = await apiRequest("DELETE", `/api/import-config/rules/${id}`);
      return res.json();
    },
    onSuccess: (_data, { profileId }) => {
      qc.invalidateQueries({ queryKey: profileRulesKey(profileId) });
      qc.invalidateQueries({ queryKey: PROFILES_KEY });
    },
  });
}

export function useDeleteImportProfile() {
  const qc = useQueryClient();
  return useMutation<{ success: true }, Error, number>({
    mutationFn: async (profileId) => {
      const res = await apiRequest("DELETE", `/api/import-config/profiles/${profileId}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROFILES_KEY });
    },
  });
}

// =========================================================================
// Project bindings
// =========================================================================

export interface ProjectBinding {
  id: number;
  sourceKey: string;
  matchType: string;
  projectId: number;
  projectName: string | null;
  confidence: number;
  lastUsedAt: string | null;
  timesUsed: number;
  active: boolean;
  createdAt: string;
}

interface BindingsResponse {
  bindings: ProjectBinding[];
}

const BINDINGS_KEY = ["/api/import-config/bindings"] as const;

export function useProjectBindings(enabled = true) {
  return useQuery<BindingsResponse>({
    queryKey: BINDINGS_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

export function useDeleteProjectBinding() {
  const qc = useQueryClient();
  return useMutation<{ success: true }, Error, number>({
    mutationFn: async (id) => {
      const res = await apiRequest("DELETE", `/api/import-config/bindings/${id}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BINDINGS_KEY });
    },
  });
}

// =========================================================================
// Teams alert settings
// =========================================================================

export interface ImportAlertSettings {
  alertsEnabled: boolean;
  alertTeamId: string | null;
  alertChannelId: string | null;
  alertSenderUserId: number | null;
  alertOnFailure: boolean;
  alertOnReview: boolean;
}

interface AlertSettingsResponse {
  configured: boolean;
  alerts: ImportAlertSettings | null;
}

const ALERT_SETTINGS_KEY = ["/api/import-config/alert-settings"] as const;

export function useImportAlertSettings(enabled = true) {
  return useQuery<AlertSettingsResponse>({
    queryKey: ALERT_SETTINGS_KEY,
    queryFn: getQueryFn({ on401: "throw" }),
    enabled,
  });
}

export type UpdateAlertSettingsPayload = Partial<ImportAlertSettings>;

export function useUpdateImportAlertSettings() {
  const qc = useQueryClient();
  return useMutation<
    { alerts: ImportAlertSettings },
    Error,
    UpdateAlertSettingsPayload
  >({
    mutationFn: async (payload) => {
      const res = await apiRequest("PUT", "/api/import-config/alert-settings", payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ALERT_SETTINGS_KEY });
    },
  });
}
