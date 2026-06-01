/// <reference types="vite/client" />

// File System Access API — not present in this TS version's default DOM lib.
// Minimal typing so the deliverable "save to mapped folder" flow can call
// showSaveFilePicker without a `@ts-ignore`. Optional because most browsers
// (and SSR) don't expose it; callers guard before use.
interface FileSystemWritableFileStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStream>;
}
interface Window {
  showSaveFilePicker?(options?: { suggestedName?: string }): Promise<FileSystemFileHandleLike>;
}
