import fs from "fs";
import path from "path";
import { Request } from "express";
import { FileFilterCallback } from "multer";

// Allowed MIME types for document uploads
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // .xlsx
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-excel",       // .xls
  "application/msword",             // .doc
  "application/vnd.ms-powerpoint",  // .ppt
  "application/vnd.ms-excel.sheet.macroEnabled.12", // .xlsm
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/octet-stream", // generic binary — validated by magic bytes
]);

// Magic byte signatures: [byte sequence, description]
const MAGIC_SIGNATURES: Array<{ bytes: number[]; mimes: string[] }> = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mimes: ["application/pdf"] },
  { bytes: [0x50, 0x4b, 0x03, 0x04], mimes: [
    "application/zip",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
  ]},
  { bytes: [0x50, 0x4b, 0x05, 0x06], mimes: ["application/zip"] }, // empty zip
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], mimes: [
    "application/vnd.ms-excel",
    "application/msword",
    "application/vnd.ms-powerpoint",
  ]},
  { bytes: [0xff, 0xd8, 0xff], mimes: ["image/jpeg"] },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mimes: ["image/png"] },
  { bytes: [0x47, 0x49, 0x46, 0x38], mimes: ["image/gif"] },
  { bytes: [0x52, 0x49, 0x46, 0x46], mimes: ["image/webp"] }, // RIFF header used by WebP
];

/**
 * Multer fileFilter that rejects declared MIME types not in the allowlist.
 * This is the fast pre-check — magic byte validation happens post-write.
 */
export function allowedMimeFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type '${file.mimetype}' is not permitted.`));
  }
}

/**
 * Post-write magic byte validation. Call after multer has saved the file.
 * Returns null if valid, or an error message string if the file is rejected.
 * Also deletes the file on failure to avoid leaving rejected uploads on disk.
 */
export async function validateMagicBytes(filePath: string, declaredMime: string): Promise<string | null> {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);

    // plain text and CSV have no magic bytes — allow if declared
    if (declaredMime === "text/plain" || declaredMime === "text/csv") {
      return null;
    }

    const matched = MAGIC_SIGNATURES.find((sig) =>
      sig.bytes.every((b, i) => buf[i] === b),
    );

    if (!matched) {
      fs.unlinkSync(filePath);
      return `File content does not match any recognised format.`;
    }

    if (!matched.mimes.includes(declaredMime) && declaredMime !== "application/octet-stream") {
      // ZIP magic bytes cover all Office Open XML; allow that family
      const zipFamily = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
      ];
      const isZipSignature = matched.bytes[0] === 0x50 && matched.bytes[1] === 0x4b;
      if (!(isZipSignature && zipFamily.includes(declaredMime))) {
        fs.unlinkSync(filePath);
        return `File content does not match declared type '${declaredMime}'.`;
      }
    }

    return null;
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch {}
    return `File validation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Sanitise the upload directory so it cannot be path-traversed.
 * Returns null if the resolved path is outside the allowed root.
 */
export function safeUploadPath(uploadRoot: string, filename: string): string | null {
  const resolved = path.resolve(uploadRoot, filename);
  if (!resolved.startsWith(path.resolve(uploadRoot))) return null;
  return resolved;
}
