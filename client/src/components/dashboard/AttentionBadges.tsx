import { Link } from "wouter";
import { ArrowRight, ListChecks } from "lucide-react";

export interface AttentionItem {
  label: string;
  value: number;
  color: string;
  href: string;
}

interface AttentionBadgesProps {
  items: AttentionItem[];
  /** Only show items whose value exceeds this threshold (default 5) */
  threshold?: number;
  title?: string;
  testId?: string;
}

export function AttentionBadges({
  items,
  threshold = 5,
  title = "Attention Needed",
  testId = "section-attention-needed",
}: AttentionBadgesProps) {
  const visible = items.filter((a) => a.value > threshold);
  if (visible.length === 0) return null;

  return (
    <div className="mb-6" data-testid={testId}>
      <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <ListChecks className="w-3.5 h-3.5" />
        {title}
      </h2>
      <div className="flex flex-wrap gap-2">
        {visible.map((a) => (
          <Link key={a.label} href={a.href}>
            <span
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer transition-colors hover:opacity-80 ${a.color}`}
            >
              <span className="font-mono font-bold text-base">{a.value}</span>
              {a.label}
              <ArrowRight className="w-3.5 h-3.5 opacity-50" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
