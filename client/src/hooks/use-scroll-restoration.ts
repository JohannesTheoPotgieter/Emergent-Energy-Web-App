import { useEffect, useRef } from "react";

const STORAGE_KEY = "eeos-scroll-positions";

type ScrollMap = Record<string, number>;

function readScrollMap(): ScrollMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ScrollMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeScrollMap(map: ScrollMap) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function useScrollRestoration(location: string) {
  const previousLocationRef = useRef(location);
  const fromPopStateRef = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      fromPopStateRef.current = true;
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const previousLocation = previousLocationRef.current;
    const map = readScrollMap();
    map[previousLocation] = window.scrollY;
    writeScrollMap(map);

    const nextLocation = location;
    const nextY = map[nextLocation];

    if (fromPopStateRef.current && typeof nextY === "number") {
      requestAnimationFrame(() => {
        window.scrollTo({ top: nextY, behavior: "auto" });
      });
    } else {
      window.scrollTo({ top: 0, behavior: "auto" });
    }

    previousLocationRef.current = nextLocation;
    fromPopStateRef.current = false;
  }, [location]);
}
