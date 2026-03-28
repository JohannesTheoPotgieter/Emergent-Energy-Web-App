import path from "path";
import type { Request } from "express";
import type multer from "multer";

const ALLOWED_EXTENSIONS = new Set([
  ".xlsx", ".xls", ".csv", ".pdf", ".doc", ".docx",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".zip", ".json", ".txt", ".pptx", ".ppt",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr",
  ".ps1", ".sh", ".bash", ".vbs", ".js", ".ts",
  ".php", ".py", ".rb", ".pl", ".jar", ".war",
]);

export function sanitizeFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename, ext)
    .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, "_")
    .substring(0, 200);
  return `${base}${ext}`;
}

export function allowedFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  const ext = path.extname(file.originalname).toLowerCase();

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type ${ext} is not allowed`));
  }

  if (ALLOWED_EXTENSIONS.size > 0 && !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type ${ext} is not supported`));
  }

  cb(null, true);
}
