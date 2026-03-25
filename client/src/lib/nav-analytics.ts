interface NavEvent {
  type: "nav_click" | "page_view" | "feature_use";
  section?: string;
  secondaryItem?: string;
  path?: string;
  feature?: string;
  timestamp: string;
}

let eventBuffer: NavEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushEvents, 30_000);
}

async function flushEvents() {
  flushTimer = null;
  if (eventBuffer.length === 0) return;

  const batch = [...eventBuffer];
  eventBuffer = [];

  try {
    const res = await fetch("/api/analytics/nav-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ events: batch }),
    });
    // Gracefully no-op if endpoint doesn't exist yet
    if (res.status === 404) return;
  } catch {
    // Analytics should never block UX
  }
}

function pushEvent(event: NavEvent) {
  eventBuffer.push(event);
  scheduleFlush();
}

export function trackNavClick(section: string, secondaryItem?: string) {
  pushEvent({
    type: "nav_click",
    section,
    secondaryItem,
    timestamp: new Date().toISOString(),
  });
}

export function trackPageView(path: string, section: string) {
  pushEvent({
    type: "page_view",
    path,
    section,
    timestamp: new Date().toISOString(),
  });
}

export function trackFeatureUse(feature: string) {
  pushEvent({
    type: "feature_use",
    feature,
    timestamp: new Date().toISOString(),
  });
}

// Flush on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    flushEvents();
  });
}
