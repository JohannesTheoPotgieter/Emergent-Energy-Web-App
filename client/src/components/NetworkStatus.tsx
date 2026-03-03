import { useState, useEffect } from "react";
import { WifiOff, Wifi } from "lucide-react";

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        setShowReconnected(true);
        setTimeout(() => setShowReconnected(false), 3000);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [wasOffline]);

  if (!isOnline) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 shadow-lg"
        data-testid="banner-offline"
      >
        <WifiOff className="h-4 w-4" />
        You're offline. Changes won't be saved until your connection is restored.
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-[100] bg-green-600 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 shadow-lg animate-in slide-in-from-top duration-300"
        data-testid="banner-reconnected"
      >
        <Wifi className="h-4 w-4" />
        Back online
      </div>
    );
  }

  return null;
}
