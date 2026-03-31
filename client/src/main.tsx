import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("csrf-token="))
      ?.split("=")[1];
    if (csrf) {
      const headers = new Headers(init?.headers);
      if (!headers.has("X-CSRF-Token")) {
        headers.set("X-CSRF-Token", csrf);
      }
      init = { ...init, headers };
    }
  }
  return originalFetch.call(this, input, init);
};

createRoot(document.getElementById("root")!).render(<App />);
