import { useState, useCallback, useEffect } from "react";

const GUIDANCE_KEY = "ux_guidance";

function getGuidanceStore(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(GUIDANCE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setGuidanceStore(data: Record<string, any>) {
  localStorage.setItem(GUIDANCE_KEY, JSON.stringify(data));
}

export function useWalkthroughCompleted(screenId: string) {
  const key = `walkthrough_${screenId}`;
  const [completed, setCompleted] = useState(() => {
    const store = getGuidanceStore();
    return !!store[key];
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === key) {
        setCompleted(detail.completed);
      }
    };
    window.addEventListener("guidance-update", handler);
    return () => window.removeEventListener("guidance-update", handler);
  }, [key]);

  const markCompleted = useCallback(() => {
    const store = getGuidanceStore();
    store[key] = Date.now();
    setGuidanceStore(store);
    setCompleted(true);
    window.dispatchEvent(new CustomEvent("guidance-update", { detail: { key, completed: true } }));
  }, [key]);

  const reset = useCallback(() => {
    const store = getGuidanceStore();
    delete store[key];
    setGuidanceStore(store);
    setCompleted(false);
    window.dispatchEvent(new CustomEvent("guidance-update", { detail: { key, completed: false } }));
  }, [key]);

  return { completed, markCompleted, reset };
}

export function useTipDismissed(tipId: string) {
  const key = `tip_${tipId}`;
  const [dismissed, setDismissed] = useState(() => {
    const store = getGuidanceStore();
    return !!store[key];
  });

  const dismiss = useCallback(() => {
    const store = getGuidanceStore();
    store[key] = Date.now();
    setGuidanceStore(store);
    setDismissed(true);
  }, [key]);

  return { dismissed, dismiss };
}

export function useLastSelection(fieldId: string) {
  const key = `last_${fieldId}`;

  const getLastValue = useCallback((): string | null => {
    const store = getGuidanceStore();
    return store[key] || null;
  }, [key]);

  const saveLastValue = useCallback((value: string) => {
    const store = getGuidanceStore();
    store[key] = value;
    setGuidanceStore(store);
  }, [key]);

  return { getLastValue, saveLastValue };
}

export interface NextAction {
  label: string;
  description?: string;
  action?: () => void;
  severity?: "info" | "warning" | "urgent";
}

export interface BlockerInfo {
  label: string;
  count?: number;
  severity?: "warning" | "urgent";
}

export interface OwnerInfo {
  name: string;
  role?: string;
}

export interface ScreenContext {
  nextAction: NextAction | null;
  blockers: BlockerInfo[];
  owners: OwnerInfo[];
}
