// ============================================================
// /my-queue — "What needs me right now?"
//
// PR-C of the truth/clear/simple redesign.
//
// Replaces the per-board scatter (open PO board → filter to My
// Reviews; open Payment Request board → filter to In Review; etc.)
// with a single grouped page that lists everything blocked on the
// caller. The /now page deep-links here.
//
// Truth — every row is a real item with an action verb the user
// can do today. Empty buckets render "Nothing waiting on you here"
// rather than hiding (so the user can trust the page is current).
// Clear — one section per category. One H1. Action labels are verbs
// ("Approve" / "Review" / "Decide"), not nouns.
// Simple — single fetch. No filter dropdowns. No bulk actions in
// the queue — open the item and act from its native page.
// ============================================================

import { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/queryClient';
import {
  statusClasses,
  TYPOGRAPHY,
} from '@/lib/design-tokens';
import {
  ArrowRight,
  ClipboardCheck,
  CreditCard,
  GitBranch,
  ShieldAlert,
  Inbox,
} from 'lucide-react';

// ===================== Types =====================

interface QueueItem {
  id: number;
  title: string;
  subtitle?: string;
  projectId: number | null;
  raisedAt: string | null;
  href: string;
  actionLabel: string;
}

interface QueueBucket {
  count: number;
  items: QueueItem[];
  error: string | null;
}

interface MyQueueResponse {
  pos: QueueBucket;
  paymentRequests: QueueBucket;
  changeRequests: QueueBucket;
  stageExceptions: QueueBucket;
}

// ===================== Helpers =====================

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

function ageBadge(iso: string | null): { label: string; level: 'critical' | 'warning' | 'neutral' } | null {
  const d = ageDays(iso);
  if (d == null) return null;
  if (d >= 7) return { label: `${d}d waiting`, level: 'critical' };
  if (d >= 3) return { label: `${d}d waiting`, level: 'warning' };
  if (d > 0) return { label: `${d}d`, level: 'neutral' };
  return { label: 'today', level: 'neutral' };
}

// ===================== Bucket rendering =====================

interface BucketProps {
  title: string;
  emptyMessage: string;
  icon: typeof ClipboardCheck;
  bucket: QueueBucket | undefined;
  isLoading: boolean;
}

function BucketSection({ title, emptyMessage, icon: Icon, bucket, isLoading }: BucketProps) {
  if (isLoading) {
    return (
      <section>
        <h2 className={`${TYPOGRAPHY.SECTION} mb-2 flex items-center gap-2`}>
          <Icon className={`h-4 w-4 ${statusClasses('neutral', 'text')}`} />
          {title}
        </h2>
        <Card>
          <div className="divide-y">
            <Skeleton className="h-12 mx-4 my-3" />
            <Skeleton className="h-12 mx-4 my-3" />
          </div>
        </Card>
      </section>
    );
  }

  if (!bucket) return null;

  if (bucket.error) {
    return (
      <section>
        <h2 className={`${TYPOGRAPHY.SECTION} mb-2 flex items-center gap-2`}>
          <Icon className={`h-4 w-4 ${statusClasses('critical', 'text')}`} />
          {title}
        </h2>
        <Card>
          <div className={`px-4 py-3 text-sm ${statusClasses('critical', 'text')}`}>
            Couldn't load — {bucket.error}. This does NOT mean the queue is empty.
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section>
      <h2 className={`${TYPOGRAPHY.SECTION} mb-2 flex items-center gap-2`}>
        <Icon className={`h-4 w-4 ${statusClasses(bucket.count > 0 ? 'warning' : 'neutral', 'text')}`} />
        {title}
        {bucket.count > 0 && (
          <Badge variant="outline" className={`${statusClasses('warning', 'outline')} text-[10px]`}>
            {bucket.count}
          </Badge>
        )}
      </h2>
      <Card>
        {bucket.items.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">{emptyMessage}</div>
        ) : (
          <ul className="divide-y">
            {bucket.items.map((item) => {
              const age = ageBadge(item.raisedAt);
              return (
                <li
                  key={`${item.href}-${item.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{item.title}</div>
                    {item.subtitle && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</div>
                    )}
                    {age && (
                      <Badge
                        variant="outline"
                        className={`${statusClasses(age.level, 'outline')} text-[10px] mt-1`}
                      >
                        {age.label}
                      </Badge>
                    )}
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link href={item.href}>
                      <span className="inline-flex items-center gap-1">
                        {item.actionLabel}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

// ===================== Page =====================

export default function MyQueuePage() {
  const { data, isLoading, isError, refetch } = useQuery<MyQueueResponse>({
    queryKey: ['/api/my-queue'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/my-queue');
      if (!res.ok) throw new Error(`my-queue failed: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const totalCount = useMemo(() => {
    if (!data) return 0;
    return data.pos.count + data.paymentRequests.count + data.changeRequests.count + data.stageExceptions.count;
  }, [data]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto py-6 px-4">
      <header className="space-y-1">
        <h1 className={TYPOGRAPHY.PAGE_TITLE}>My Queue</h1>
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? 'Loading…'
            : isError
              ? "Couldn't load — please retry."
              : totalCount === 0
                ? "Nothing waiting on you right now."
                : `${totalCount} item${totalCount === 1 ? '' : 's'} waiting on you`}
          {!isLoading && !isError && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => refetch()}
                className="underline hover:no-underline"
              >
                Refresh
              </button>
            </>
          )}
        </p>
      </header>

      <BucketSection
        title="Approve"
        emptyMessage="Nothing waiting on you for POs."
        icon={ClipboardCheck}
        bucket={data?.pos}
        isLoading={isLoading}
      />

      <BucketSection
        title="Review payments"
        emptyMessage="No payment requests are in review right now."
        icon={CreditCard}
        bucket={data?.paymentRequests}
        isLoading={isLoading}
      />

      <BucketSection
        title="Change requests"
        emptyMessage="Nothing waiting on you for change requests."
        icon={GitBranch}
        bucket={data?.changeRequests}
        isLoading={isLoading}
      />

      <BucketSection
        title="Stage-gate exceptions"
        emptyMessage="No stage-gate exceptions are assigned to you."
        icon={ShieldAlert}
        bucket={data?.stageExceptions}
        isLoading={isLoading}
      />

      {/* Empty-state footer when no buckets and no loading happening. */}
      {!isLoading && !isError && totalCount === 0 && (
        <Card>
          <div className="px-6 py-10 text-center">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className={`${TYPOGRAPHY.SECTION} mb-1`}>You're caught up.</p>
            <p className="text-sm text-muted-foreground">
              Nothing is blocked on you. If a colleague is waiting, they'll tell you on{' '}
              <NowLink />.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function NowLink() {
  const [, setLocation] = useLocation();
  return (
    <button
      type="button"
      onClick={() => setLocation('/now')}
      className="underline hover:no-underline"
    >
      /now
    </button>
  );
}
