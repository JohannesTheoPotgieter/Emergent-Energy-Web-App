// Write a Teams-friendly message to the system clipboard. Microsoft Teams
// picks up HTML when pasting into the compose box, so we provide both an HTML
// blob (for rich formatting) and a plain-text fallback (for terminals, email,
// and browsers that lack `ClipboardItem`).

export interface TeamsClipboardPayload {
  html: string;
  plain: string;
}

export async function copyTeamsMessage(payload: TeamsClipboardPayload): Promise<void> {
  const { html, plain } = payload;

  if (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    "clipboard" in navigator &&
    typeof (window as any).ClipboardItem !== "undefined"
  ) {
    try {
      const htmlBlob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([plain], { type: "text/plain" });
      const item = new (window as any).ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": textBlob,
      });
      await (navigator.clipboard as any).write([item]);
      return;
    } catch {
      // Fall through to plain-text path below.
    }
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(plain);
    return;
  }

  throw new Error("Clipboard API is not available in this browser.");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
