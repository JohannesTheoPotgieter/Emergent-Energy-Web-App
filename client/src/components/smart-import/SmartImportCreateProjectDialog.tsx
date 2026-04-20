/**
 * Smart Import inline project creation (UX-4)
 *
 * When a folder upload includes a file whose filename doesn't match any
 * existing project, the user must not be forced to cancel the import,
 * navigate to another screen, create the project, and restart. This
 * dialog captures the minimum fields required to call
 *   POST /api/projects
 * and returns the new project back to the caller so the mapping grid
 * can auto-select it.
 *
 * Minimum fields are defined by the project create endpoint in
 * server/template-routes.ts — name, projectCode, client. Additional
 * optional fields (sizeKwp, province) are surfaced because the
 * Smart Import context usually has them implied by the filename
 * or a parsed header cell.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import { getAuthHeaders } from "@/pages/smart-import";

export interface CreatedProject {
  id: number;
  name: string;
  projectCode: string;
  clientName?: string;
  sizeKwp?: number | null;
  province?: string | null;
}

interface SmartImportCreateProjectDialogProps {
  /** Optional name pre-filled from the uploaded filename so the user
   *  doesn't have to retype it. */
  suggestedName?: string;
  /** Called with the freshly-created project after a successful POST. */
  onCreated: (project: CreatedProject) => void;
  onCancel?: () => void;
}

export function SmartImportCreateProjectDialog({
  suggestedName = "",
  onCreated,
  onCancel,
}: SmartImportCreateProjectDialogProps) {
  const [name, setName] = useState(suggestedName);
  const [projectCode, setProjectCode] = useState("");
  const [clientName, setClientName] = useState("");
  const [sizeKwp, setSizeKwp] = useState<string>("");
  const [province, setProvince] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    name.trim().length > 0 &&
    projectCode.trim().length > 0 &&
    clientName.trim().length > 0 &&
    !submitting;

  const handleCreate = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        projectCode: projectCode.trim(),
        clientName: clientName.trim(),
      };
      if (sizeKwp.trim().length > 0) {
        const n = Number(sizeKwp);
        if (Number.isFinite(n) && n > 0) body.sizeKwp = n;
      }
      if (province.trim().length > 0) body.province = province.trim();

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Could not create project" }));
        throw new Error(err.error || err.message || `Create failed (${res.status})`);
      }
      const created = (await res.json()) as CreatedProject;
      onCreated(created);
    } catch (err: any) {
      setError(err?.message || "Could not create project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 space-y-3"
      data-testid="inline-create-project"
    >
      <div className="flex items-center gap-2">
        <Plus className="w-4 h-4 text-emerald-700" />
        <h3 className="text-sm font-semibold">Create a new project</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        We couldn&rsquo;t auto-match this file to an existing project. Fill in the
        three fields below and we&rsquo;ll create one for you — no need to leave
        the import.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="create-project-name" className="text-xs">Project name *</Label>
          <Input
            id="create-project-name"
            data-testid="create-project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sandton Tower Solar"
          />
        </div>
        <div>
          <Label htmlFor="create-project-code" className="text-xs">Project code *</Label>
          <Input
            id="create-project-code"
            data-testid="create-project-code"
            value={projectCode}
            onChange={(e) => setProjectCode(e.target.value)}
            placeholder="e.g. ST-01"
          />
        </div>
        <div>
          <Label htmlFor="create-project-client" className="text-xs">Client *</Label>
          <Input
            id="create-project-client"
            data-testid="create-project-client"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Sandton Properties Pty Ltd"
          />
        </div>
        <div>
          <Label htmlFor="create-project-size" className="text-xs">Size (kWp)</Label>
          <Input
            id="create-project-size"
            data-testid="create-project-size"
            type="number"
            min={0}
            value={sizeKwp}
            onChange={(e) => setSizeKwp(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label htmlFor="create-project-province" className="text-xs">Province</Label>
          <Input
            id="create-project-province"
            data-testid="create-project-province"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            placeholder="Optional (e.g. Gauteng)"
          />
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800"
          data-testid="create-project-error"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
            data-testid="create-project-cancel"
          >
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!canSubmit}
          data-testid="create-project-submit"
        >
          {submitting ? (
            <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Creating…</>
          ) : (
            <><Plus className="w-3.5 h-3.5 mr-1.5" /> Create project</>
          )}
        </Button>
      </div>
    </div>
  );
}
