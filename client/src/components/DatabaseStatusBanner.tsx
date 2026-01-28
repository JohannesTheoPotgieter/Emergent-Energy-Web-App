import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface DbHealth {
  status: string;
  database: {
    mode: string;
    connected: boolean;
    message: string;
  };
}

export function DatabaseStatusBanner() {
  const [dbHealth, setDbHealth] = useState<DbHealth | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: DbHealth) => {
        setDbHealth(data);
        // Show banner if not connected to postgres
        setShowBanner(data.database.mode !== 'postgres' || !data.database.connected);
      })
      .catch(() => {
        setShowBanner(true);
      });
  }, []);

  if (!showBanner || !dbHealth) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Database Configuration Warning</AlertTitle>
      <AlertDescription>
        {dbHealth.database.message}
        {dbHealth.database.mode === 'sqlite' && (
          <span className="block mt-1">
            This deployment is running in SQLite fallback mode. Data will not persist between deployments.
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
