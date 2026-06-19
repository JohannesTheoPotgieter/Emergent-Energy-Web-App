import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

/**
 * Global keyboard navigation (R6).
 *
 * Leader-key sequence pattern used by Linear, GitHub, Notion, etc.:
 * press "g" then a letter to jump somewhere. The leader expires after
 * 1.5 seconds so normal typing isn't hijacked.
 *
 * Shortcuts intentionally scoped to navigation only — command palette
 * (⌘K) handles everything else. Shortcuts are suppressed while the
 * user is typing in an input / textarea / select / contenteditable.
 *
 *   g h   go home (/)
 *   g p   projects
 *   g s   settings
 *   g k   ⌘K palette (alt-trigger for browsers that intercept ⌘K)
 *   g a   approvals queue (the user's own, via /ceo or /coo)
 *   g d   documents admin (/admin/document-types)
 *   g q   QuickBooks home
 *   g l   lifecycle board
 *   g f   cashflow
 *   ?     keyboard shortcuts help (dispatches 'open-keyboard-help' event)
 */

const SHORTCUTS: Record<string, { path: string; label: string }> = {
  h: { path: "/", label: "Home" },
  p: { path: "/projects", label: "Projects" },
  s: { path: "/settings", label: "Settings" },
  a: { path: "/ceo", label: "Approvals (CEO)" }, // landing page auto-routes by role
  d: { path: "/admin/document-types", label: "Document types (admin)" },
  q: { path: "/quickbooks", label: "QuickBooks" },
  l: { path: "/lifecycle", label: "Lifecycle board" },
  f: { path: "/cashflow", label: "Cashflow" },
  c: { path: "/clients", label: "Clients" },
  i: { path: "/priorities", label: "Priorities" },
  e: { path: "/execution", label: "Execution" },
  g: { path: "/gates/pipeline", label: "Gates pipeline" },
};

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // Radix CommandDialog / cmdk input has role="combobox"
  const role = target.getAttribute("role");
  if (role === "combobox" || role === "textbox") return true;
  return false;
}

export function useKeyboardNav(): void {
  const [, navigate] = useLocation();
  const leaderRef = useRef<{ active: boolean; expiresAt: number } | null>(null);

  useEffect(() => {
    const LEADER_WINDOW_MS = 1500;

    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingInField(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // "?" opens keyboard help
      if (e.key === "?" && !e.shiftKey && e.code === "Slash") {
        // Some browsers need shiftKey for "?" — either is fine
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-keyboard-help"));
        return;
      }
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-keyboard-help"));
        return;
      }

      const leader = leaderRef.current;
      if (leader?.active && leader.expiresAt > Date.now()) {
        // Second key of leader sequence
        leaderRef.current = null;
        const shortcut = SHORTCUTS[e.key.toLowerCase()];
        if (shortcut) {
          e.preventDefault();
          navigate(shortcut.path);
        }
        return;
      }

      // First key — "g" arms the leader
      if (e.key.toLowerCase() === "g") {
        leaderRef.current = { active: true, expiresAt: Date.now() + LEADER_WINDOW_MS };
      } else {
        leaderRef.current = null;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);
}

export function getKeyboardShortcutList(): Array<{ keys: string; label: string }> {
  return Object.entries(SHORTCUTS).map(([k, { label }]) => ({ keys: `g ${k}`, label }));
}
