import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, RefreshCw, Home } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorPath?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, errorPath: typeof window !== "undefined" ? window.location.pathname : "" };
  }

  static getDerivedStateFromProps(_props: Props, state: State) {
    if (typeof window !== "undefined" && state.hasError && state.errorPath && window.location.pathname !== state.errorPath) {
      return { hasError: false, error: undefined, errorPath: undefined };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const errorMessage = getErrorMessage(this.state.error, "An unexpected error occurred");

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="error-boundary-page">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-6 h-6" />
                <CardTitle>Something Went Wrong</CardTitle>
              </div>
              <CardDescription>
                This page ran into a problem. You can try going back or refreshing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted p-3 rounded-md">
                <p className="text-sm font-mono text-muted-foreground break-words" data-testid="text-error-details">
                  {errorMessage}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={() => { this.setState({ hasError: false, error: undefined, errorPath: undefined }); window.history.back(); }}
                  variant="outline"
                  className="flex-1"
                  data-testid="button-error-back"
                >
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Go Back
                </Button>
                <Button
                  onClick={() => window.location.reload()}
                  className="flex-1"
                  data-testid="button-error-reload"
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Reload Page
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full text-xs"
                onClick={() => { window.location.href = "/"; }}
                data-testid="button-error-home"
              >
                <Home className="h-3.5 w-3.5 mr-1.5" />
                Go to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
