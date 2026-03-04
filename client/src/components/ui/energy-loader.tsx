import { cn } from "@/lib/utils";

export function EnergyLoader({ className, size = "md", label }: { className?: string; size?: "sm" | "md" | "lg"; label?: string }) {
  const dims = size === "sm" ? "w-8 h-8" : size === "lg" ? "w-16 h-16" : "w-12 h-12";
  const svgSize = size === "sm" ? 32 : size === "lg" ? 64 : 48;

  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <svg
        width={svgSize}
        height={svgSize}
        viewBox="0 0 48 48"
        className={dims}
      >
        <circle cx="24" cy="24" r="3" fill="#16a34a" opacity="0.8" />
        <g style={{ transformOrigin: "24px 24px", animation: "spin 2.5s linear infinite" }}>
          <rect x="22" y="6" width="4" height="16" rx="2" fill="#16a34a" opacity="0.8" />
          <rect x="22" y="6" width="4" height="16" rx="2" fill="#16a34a" opacity="0.6" transform="rotate(120 24 24)" />
          <rect x="22" y="6" width="4" height="16" rx="2" fill="#16a34a" opacity="0.4" transform="rotate(240 24 24)" />
        </g>
      </svg>
      {label && (
        <p className="text-sm text-muted-foreground animate-pulse">{label}</p>
      )}
    </div>
  );
}

export function EnergyLoadingPage({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] w-full">
      <EnergyLoader size="lg" label={label} />
    </div>
  );
}

export function SolarPanelLoader({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <svg width="56" height="56" viewBox="0 0 56 56">
        <rect x="8" y="18" width="40" height="24" rx="3" fill="#1e3a5f" transform="rotate(-10 28 30)">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
        </rect>
        <line x1="16" y1="20" x2="40" y2="20" stroke="#3b82f6" strokeWidth="0.5" opacity="0.4" transform="rotate(-10 28 30)" />
        <line x1="16" y1="28" x2="40" y2="28" stroke="#3b82f6" strokeWidth="0.5" opacity="0.4" transform="rotate(-10 28 30)" />
        <line x1="28" y1="14" x2="28" y2="38" stroke="#3b82f6" strokeWidth="0.5" opacity="0.4" transform="rotate(-10 28 30)" />
        <rect x="26" y="38" width="4" height="10" rx="1" fill="#94a3b8" />
        <circle cx="42" cy="10" r="6" fill="#fbbf24" opacity="0.7">
          <animate attributeName="r" values="6;8;6" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="42" cy="10" r="10" fill="#fbbf24" opacity="0.1">
          <animate attributeName="r" values="10;13;10" dur="3s" repeatCount="indefinite" />
        </circle>
      </svg>
      <p className="text-xs text-muted-foreground">Harnessing energy...</p>
    </div>
  );
}

export function EnergyEmptyState({ title, description, icon }: { title: string; description?: string; icon?: "solar" | "wind" | "battery" }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="mb-4">
        {icon === "wind" ? (
          <svg width="64" height="64" viewBox="0 0 64 64" className="text-green-500 opacity-40">
            <rect x="30" y="20" width="4" height="36" rx="1" fill="currentColor" />
            <circle cx="32" cy="20" r="4" fill="currentColor" opacity="0.6" />
            <g style={{ transformOrigin: "32px 20px", animation: "spin 4s linear infinite" }}>
              <rect x="30" y="4" width="4" height="16" rx="2" fill="currentColor" opacity="0.7" />
              <rect x="30" y="4" width="4" height="16" rx="2" fill="currentColor" opacity="0.5" transform="rotate(120 32 20)" />
              <rect x="30" y="4" width="4" height="16" rx="2" fill="currentColor" opacity="0.3" transform="rotate(240 32 20)" />
            </g>
          </svg>
        ) : icon === "battery" ? (
          <svg width="64" height="64" viewBox="0 0 64 64" className="text-green-500 opacity-40">
            <rect x="14" y="20" width="36" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="50" y="28" width="4" height="8" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="18" y="24" width="8" height="16" rx="2" fill="currentColor" opacity="0.3">
              <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2s" repeatCount="indefinite" />
            </rect>
            <rect x="28" y="24" width="8" height="16" rx="2" fill="currentColor" opacity="0.2">
              <animate attributeName="opacity" values="0.2;0.5;0.2" dur="2s" repeatCount="indefinite" begin="0.5s" />
            </rect>
          </svg>
        ) : (
          <svg width="64" height="64" viewBox="0 0 64 64" className="text-green-500 opacity-40">
            <rect x="12" y="28" width="40" height="20" rx="3" fill="currentColor" opacity="0.3" transform="rotate(-15 32 38)" />
            <line x1="20" y1="32" x2="44" y2="32" stroke="currentColor" strokeWidth="0.8" opacity="0.3" transform="rotate(-15 32 38)" />
            <line x1="32" y1="24" x2="32" y2="46" stroke="currentColor" strokeWidth="0.8" opacity="0.3" transform="rotate(-15 32 38)" />
            <rect x="30" y="44" width="4" height="8" rx="1" fill="currentColor" opacity="0.4" />
            <circle cx="48" cy="14" r="6" fill="#fbbf24" opacity="0.3">
              <animate attributeName="opacity" values="0.2;0.4;0.2" dur="3s" repeatCount="indefinite" />
            </circle>
          </svg>
        )}
      </div>
      <h3 className="text-base font-medium text-muted-foreground mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground/70 max-w-xs">{description}</p>}
    </div>
  );
}
