/**
 * Shared display helpers for the discipline document workspace: the status chip
 * (managed-document state → human label) and the coloured file-type icon. Kept
 * in one place so the list table and the grid view stay visually consistent.
 */

import { Folder } from "lucide-react";

export type ManagedDocState = "draft" | "in_review" | "approved" | "superseded" | "archived";

const STATUS_MAP: Record<ManagedDocState, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  in_review: { label: "For review", className: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700" },
  superseded: { label: "Superseded", className: "bg-slate-100 text-slate-400 line-through" },
  archived: { label: "Superseded", className: "bg-slate-100 text-slate-400 line-through" },
};

export function DocumentStatusChip({ state }: { state: ManagedDocState }) {
  const cfg = STATUS_MAP[state] ?? STATUS_MAP.draft;
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.className}`}
      data-testid={`document-status-${state}`}
    >
      {cfg.label}
    </span>
  );
}

interface TypeStyle {
  label: string;
  className: string;
}

/** Map a filename extension to a short label + colour, à la the mockup. */
function typeStyle(name: string): TypeStyle {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "pdf":
      return { label: "PDF", className: "bg-red-500" };
    case "dwg":
    case "dxf":
      return { label: "DWG", className: "bg-indigo-500" };
    case "xls":
    case "xlsx":
    case "csv":
      return { label: "XLS", className: "bg-emerald-600" };
    case "doc":
    case "docx":
      return { label: "DOC", className: "bg-blue-600" };
    case "ppt":
    case "pptx":
      return { label: "PPT", className: "bg-orange-500" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return { label: "IMG", className: "bg-fuchsia-500" };
    default:
      return { label: ext ? ext.slice(0, 3).toUpperCase() : "FILE", className: "bg-slate-400" };
  }
}

export function FileTypeIcon({
  name,
  isFolder,
  size = "sm",
}: {
  name: string;
  isFolder: boolean;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "h-12 w-12 text-base" : "h-8 w-8 text-[11px]";
  if (isFolder) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-lg bg-amber-400 text-white ${dim}`}>
        <Folder className={size === "lg" ? "h-6 w-6" : "h-4 w-4"} />
      </div>
    );
  }
  const t = typeStyle(name);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg font-bold text-white ${t.className} ${dim}`}
      aria-hidden
    >
      {t.label}
    </div>
  );
}
