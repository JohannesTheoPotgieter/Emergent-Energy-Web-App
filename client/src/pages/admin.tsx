import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Loader2, Play, RefreshCw } from "lucide-react";

interface SmokeTestCheck {
  name: string;
  passed: boolean;
  details: any;
}

interface SmokeTestResult {
  passed: boolean;
  checks: SmokeTestCheck[];
  error?: string;
  code?: string;
  timestamps: {
    started: string;
    completed: string;
    durationMs: number;
  };
}

export default function AdminPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SmokeTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSmokeTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/smoke-test", {
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Authentication required. Please log in.");
        }
        if (res.status === 403) {
          throw new Error("Admin access required.");
        }
        throw new Error(`Server error: ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Failed to run smoke test");
    } finally {
      setLoading(false);
    }
  };

  const formatCheckName = (name: string) => {
    return name
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  if (user?.role !== "admin") {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Admin access is required to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">System health and smoke tests</p>
        </div>
        <Button
          onClick={runSmokeTest}
          disabled={loading}
          data-testid="button-run-smoke-test"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Run Smoke Test
            </>
          )}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p data-testid="text-smoke-test-error">{error}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <Card className={result.passed ? "border-green-500" : "border-destructive"}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  {result.passed ? (
                    <CheckCircle className="h-6 w-6 text-green-500" />
                  ) : (
                    <XCircle className="h-6 w-6 text-destructive" />
                  )}
                  Smoke Test {result.passed ? "Passed" : "Failed"}
                </CardTitle>
                <Badge variant={result.passed ? "default" : "destructive"} data-testid="badge-smoke-test-result">
                  {result.checks.filter((c) => c.passed).length} / {result.checks.length} checks passed
                </Badge>
              </div>
              <CardDescription>
                Completed in {result.timestamps.durationMs}ms at{" "}
                {new Date(result.timestamps.completed).toLocaleString()}
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {result.checks.map((check, index) => (
              <Card key={index} className={check.passed ? "" : "border-destructive/50"}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    {check.passed ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    {formatCheckName(check.name)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre
                    className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40"
                    data-testid={`details-${check.name}`}
                  >
                    {JSON.stringify(check.details, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ))}
          </div>

          {result.error && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Test Error</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{result.error}</p>
                {result.code && (
                  <Badge variant="outline" className="mt-2">
                    Code: {result.code}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!loading && !result && !error && (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Test Results</h3>
            <p className="text-muted-foreground mb-4">
              Click "Run Smoke Test" to validate system health and data integrity.
            </p>
            <p className="text-sm text-muted-foreground">
              The smoke test checks: database connectivity, authentication, uploads, data presence, 
              cashflow series, revenue/COS data, and override functionality.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
