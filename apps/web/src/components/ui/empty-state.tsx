import * as React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

/**
 * Empty and error states.
 *
 * The brief requires an empty state on every list. An empty state that says
 * "No results" wastes the moment — these all name the next useful action, because
 * the first run of any screen is the one a new user judges the product on.
 */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** The next useful action. A button, a link, or a fragment of both. */
  action?: React.ReactNode;
  /** A quieter secondary action — "clear filters", "learn more". */
  secondaryAction?: React.ReactNode;
  className?: string;
  /** Compact variant for a narrow column such as a sidebar panel. */
  compact?: boolean;
}

function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-center',
        compact ? 'gap-3 px-5 py-8' : 'gap-4 px-6 py-14',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-muted text-muted-foreground',
            compact ? 'size-10 [&_svg]:size-5' : 'size-14 [&_svg]:size-6',
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}

      <div className="max-w-md space-y-1.5">
        <h3 className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        {description && (
          <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
            {description}
          </p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error state                                                                */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Renders a retry button when supplied. */
  onRetry?: () => void;
  /** The API's correlation id, shown so a user can quote it in a bug report. */
  requestId?: string;
  className?: string;
  compact?: boolean;
}

/**
 * Error state.
 *
 * Deliberately not alarming in tone — most errors here are a transient network
 * problem. The request id is surfaced because it is the one piece of information
 * that makes a support conversation short.
 */
function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this right now. Please try again.',
  onRetry,
  requestId,
  className,
  compact,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-destructive/25 bg-destructive/5 text-center',
        compact ? 'gap-3 px-5 py-8' : 'gap-4 px-6 py-12',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-destructive/10 text-destructive',
          compact ? 'size-10 [&_svg]:size-5' : 'size-14 [&_svg]:size-6',
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>

      <div className="max-w-md space-y-1.5">
        <h3 className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          {description}
        </p>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent"
        >
          Try again
        </button>
      )}

      {requestId && (
        <p className="font-mono text-[11px] text-muted-foreground">Reference: {requestId}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading states                                                             */
/* -------------------------------------------------------------------------- */

/** Skeleton for a list of cards. Matches the real card's height so nothing jumps. */
function CardListSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-4', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-start gap-4">
            <Skeleton className="size-12 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a table body. */
function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="flex gap-4 border-b border-border pb-3">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 py-1.5">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} className={cn('h-4 flex-1', colIndex === 0 && 'w-1/3 flex-none')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a stat-card row. */
function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
          <Skeleton className="mt-4 h-7 w-24" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export { EmptyState, ErrorState, CardListSkeleton, TableSkeleton, StatsSkeleton };
