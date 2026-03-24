import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error("An unexpected error occurred while loading data.");
}

export function QueryErrorBanner({ error }: { error: unknown }) {
  const resolvedError = normalizeError(error);

  return (
    <Alert variant="destructive" data-testid="query-error-banner">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{resolvedError.message}</AlertDescription>
    </Alert>
  );
}
