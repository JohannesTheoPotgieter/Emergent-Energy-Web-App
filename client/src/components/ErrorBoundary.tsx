import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Safely extract error message
      let errorMessage = "Unknown error";
      
      const err: any = this.state.error;
      
      if (err) {
        if (err instanceof Error) {
          errorMessage = err.message || "Unknown error";
        } else if (typeof err === 'string') {
          errorMessage = err;
        } else if (typeof err === 'object' && 'message' in err) {
          errorMessage = String(err.message);
        } else {
          errorMessage = String(err);
        }
      }
      
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-6 h-6" />
                <CardTitle>Application Error</CardTitle>
              </div>
              <CardDescription>Something went wrong loading the dashboard</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted p-3 rounded-md">
                <p className="text-sm font-mono text-muted-foreground">
                  {errorMessage}
                </p>
              </div>
              <Button 
                onClick={() => window.location.reload()} 
                className="w-full"
              >
                Reload Page
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
