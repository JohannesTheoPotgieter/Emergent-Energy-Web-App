import { useState, useCallback } from "react";

const STORAGE_KEY = "ee_nav_section_order";

export function useNavPreferences() {
  const [sectionOrder, setSectionOrderState] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const setSectionOrder = useCallback((order: string[]) => {
    setSectionOrderState(order);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  }, []);

  const resetOrder = useCallback(() => {
    setSectionOrderState([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { sectionOrder, setSectionOrder, resetOrder };
}
