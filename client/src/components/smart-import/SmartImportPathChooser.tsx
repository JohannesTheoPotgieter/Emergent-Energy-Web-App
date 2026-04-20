/**
 * Smart Import path chooser (UX-1)
 *
 * Renders the two-path choice at the top of the upload step:
 *   ┌ Import one file ┐   ┌ Import a folder ┐
 * Plus a compact "how this works" explainer that changes based on the
 * picked mode, and a persistent safety / reversibility badge.
 *
 * Intentionally self-contained — takes the current mode + a setter and
 * reads all copy from labels.ts so the language can be refined in one
 * place by a non-engineer.
 */

import { FileText, FolderOpen, ShieldCheck, Download, PlayCircle } from "lucide-react";
import { UPLOAD_LABELS } from "./labels";

export type UploadMode = "single" | "folder";

interface SmartImportPathChooserProps {
  mode: UploadMode;
  onModeChange: (mode: UploadMode) => void;
  onDownloadTemplate?: () => void;
  onOpenGuide?: () => void;
}

export function SmartImportPathChooser({
  mode,
  onModeChange,
  onDownloadTemplate,
  onOpenGuide,
}: SmartImportPathChooserProps) {
  const steps = mode === "single"
    ? UPLOAD_LABELS.howItWorks.single
    : UPLOAD_LABELS.howItWorks.folder;

  return (
    <div className="space-y-4" data-testid="path-chooser">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PathCard
          testId="path-card-single"
          active={mode === "single"}
          icon={<FileText className="w-5 h-5" />}
          title={UPLOAD_LABELS.singleMode.title}
          subtitle={UPLOAD_LABELS.singleMode.subtitle}
          description={UPLOAD_LABELS.singleMode.description}
          onClick={() => onModeChange("single")}
        />
        <PathCard
          testId="path-card-folder"
          active={mode === "folder"}
          icon={<FolderOpen className="w-5 h-5" />}
          title={UPLOAD_LABELS.folderMode.title}
          subtitle={UPLOAD_LABELS.folderMode.subtitle}
          description={UPLOAD_LABELS.folderMode.description}
          onClick={() => onModeChange("folder")}
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4" data-testid="how-it-works">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">
          How this works
        </p>
        <ol className="space-y-1.5 text-sm text-foreground/80">
          {steps.map((line, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="inline-flex w-5 h-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-xs font-medium">
                {idx + 1}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>

      <div
        className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800"
        data-testid="safety-badge"
      >
        <ShieldCheck className="w-4 h-4 flex-shrink-0" />
        <span>{UPLOAD_LABELS.safety}</span>
      </div>

      {(onDownloadTemplate || onOpenGuide) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {onDownloadTemplate && (
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="inline-flex items-center gap-1.5 text-blue-700 hover:text-blue-800 hover:underline"
              data-testid="btn-download-template"
            >
              <Download className="w-4 h-4" />
              {UPLOAD_LABELS.templateLink}
            </button>
          )}
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="inline-flex items-center gap-1.5 text-blue-700 hover:text-blue-800 hover:underline"
              data-testid="btn-open-guide"
            >
              <PlayCircle className="w-4 h-4" />
              {UPLOAD_LABELS.guideLink}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface PathCardProps {
  testId: string;
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  onClick: () => void;
}

function PathCard({ testId, active, icon, title, subtitle, description, onClick }: PathCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={`text-left rounded-lg border-2 p-4 transition-colors ${
        active
          ? "border-emerald-500 bg-emerald-50"
          : "border-border bg-card hover:border-emerald-300 hover:bg-emerald-50/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex w-9 h-9 flex-shrink-0 items-center justify-center rounded-full ${
            active ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
          }`}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-base text-foreground">{title}</span>
            <span
              className={`text-xs ${
                active ? "text-emerald-700 font-medium" : "text-muted-foreground"
              }`}
            >
              {active ? "Selected" : subtitle}
            </span>
          </div>
          {!active && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
          <p className="text-sm text-foreground/80 mt-1.5">{description}</p>
        </div>
      </div>
    </button>
  );
}
