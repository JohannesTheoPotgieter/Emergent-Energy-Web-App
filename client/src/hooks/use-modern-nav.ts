/**
 * Modern-navigation toggle. Defaults ON (the new registry-driven sidebar);
 * a "Classic navigation" switch in the user menu flips it back to the legacy
 * top-tab AppLayout. Stored client-side so it needs no server flag, and shared
 * across components via a tiny external store so toggling updates immediately.
 */
import { useCallback, useSyncExternalStore } from "react";

const KEY = "ee_modern_nav";
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof localStorage === "undefined") return true;
  const v = localStorage.getItem(KEY);
  return v === null ? true : v === "true";
}

function write(value: boolean): void {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useModernNav() {
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  const setEnabled = useCallback((value: boolean) => write(value), []);
  const toggle = useCallback(() => write(!read()), []);
  return { enabled, setEnabled, toggle };
}
