export function getQueryError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function formatIntegrationStatus(status: string | undefined) {
  if (!status) return "Not Connected";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
