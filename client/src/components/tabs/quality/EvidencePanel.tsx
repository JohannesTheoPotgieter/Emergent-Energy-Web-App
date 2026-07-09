import { useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Paperclip, ExternalLink, Trash2, Upload, Loader2, Camera } from "lucide-react";
import { isImageEvidenceUrl } from "@/lib/quality-ui-helpers";

export interface EvidenceUploadStatus {
  state: "uploaded" | "uploading" | "error" | string;
  message: string;
}

/**
 * Evidence list + upload for a single checklist item (Task 3.3 extraction
 * from QualityTab). Owns its own file/camera input refs and drag state; the
 * parent supplies the evidence rows, the upload/delete callbacks and the
 * per-item upload status.
 */
export function EvidencePanel({
  itemId,
  evidence,
  canEdit,
  uploading,
  uploadStatus,
  onUpload,
  onDelete,
}: {
  itemId: number;
  evidence: any[];
  canEdit: boolean;
  uploading: boolean;
  uploadStatus?: EvidenceUploadStatus;
  onUpload: (file: File) => void;
  onDelete: (evidenceId: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Evidence ({evidence.length})
        </Label>
      </div>
      {evidence.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {evidence.map((ev: any) => (
            <div key={ev.id} className="flex items-center gap-2 text-xs bg-muted rounded-lg border p-2.5" data-testid={`evidence-${ev.id}`}>
              {isImageEvidenceUrl(ev.evidenceUrl) ? (
                <a href={ev.evidenceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0" data-testid={`evidence-thumb-${ev.id}`}>
                  <img
                    src={ev.evidenceUrl}
                    alt={ev.evidenceNote || "Evidence photo"}
                    loading="lazy"
                    className="w-10 h-10 rounded object-cover border"
                  />
                </a>
              ) : (
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="flex-1 truncate">{ev.evidenceNote || ev.evidenceUrl}</span>
              {ev.evidenceUrl && (
                <a href={ev.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 p-0.5" data-testid={`view-evidence-${ev.id}`}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {canEdit && (
                <button
                  className="text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-red-50"
                  onClick={() => onDelete(ev.id)}
                  data-testid={`delete-evidence-${ev.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div
          className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-border hover:border-blue-300 hover:bg-blue-50/30"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = e.dataTransfer.files;
            if (files.length > 0) onUpload(files[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          data-testid={`evidence-dropzone-${itemId}`}
        >
          <input
            type="file"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
            data-testid={`evidence-input-${itemId}`}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Upload className="w-6 h-6 text-muted-foreground/60" />
              <span className="text-xs text-muted-foreground">Drop file here or click to upload</span>
            </div>
          )}
        </div>
      )}
      {canEdit && (
        <>
          {/* Task 3.1: mobile/site camera capture — opens the rear camera. */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            ref={cameraInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
            data-testid={`evidence-camera-input-${itemId}`}
          />
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading}
            data-testid={`evidence-camera-btn-${itemId}`}
          >
            <Camera className="w-3.5 h-3.5" /> Take photo
          </button>
        </>
      )}
      {uploadStatus && (
        <div
          className={`mt-2 text-xs rounded-md border px-2.5 py-1.5 ${
            uploadStatus.state === "uploaded"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : uploadStatus.state === "uploading"
                ? "bg-blue-50 text-blue-700 border-blue-200"
                : "bg-red-50 text-red-700 border-red-200"
          }`}
          data-testid={`evidence-upload-status-${itemId}`}
        >
          {uploadStatus.message}
        </div>
      )}
    </div>
  );
}
