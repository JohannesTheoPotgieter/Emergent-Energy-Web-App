export function enforceRuntimeEnvironmentGuards(): { sessionSecret: string; isStrictRuntime: boolean } {
  const sessionSecret = process.env.SESSION_SECRET;
  const isStrictRuntime = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";

  if (isStrictRuntime && !sessionSecret) {
    throw new Error("SESSION_SECRET must be set in staging/production. Refusing to start with an unsafe default secret.");
  }

  if (!sessionSecret) {
    const fallback = "dev-session-secret-not-for-production";
    console.warn("[Session] SESSION_SECRET not set — using insecure dev fallback. Set SESSION_SECRET for production.");
    return { sessionSecret: fallback, isStrictRuntime };
  }

  return { sessionSecret, isStrictRuntime };
}
