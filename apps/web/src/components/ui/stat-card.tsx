import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from './card';

/**
 * Stat card.
 *
 * The most reused component in the product — it appears on all five dashboards.
 *
 * Two details that make it earn its place:
 *  * The `trend` renders direction *and* magnitude, because "+12" with no context
 *    is not actionable and a bare arrow is ambiguous.
 *  * The whole card is a link when `href` is given, so a KPI is always a route into
 *    the detail behind it. A dashboard of dead-end numbers is a report, not a tool.
 */

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Small text under the value — a unit, a comparator or a caveat. */
  hint?: string;
  icon?: React.ReactNode;
  /** Directional change. `value` is the magnitude, e.g. 12 for "+12%". */
  trend?: { value: number; label?: string; /** Set when a fall is good, e.g. time-to-hire. */ inverted?: boolean };
  /** Makes the card a link. */
  href?: string;
  /** Accent for the icon tile. */
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'purple' | 'teal';
  /** Renders a skeleton of the same shape. */
  loading?: boolean;
  className?: string;
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  purple: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  href,
  tone = 'default',
  loading,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <Card className={cn('', className)}>
        <div className="flex items-start justify-between gap-3">
          <div className="shimmer h-3 w-20 rounded bg-muted" />
          <div className="shimmer size-9 rounded-lg bg-muted" />
        </div>
        <div className="shimmer mt-4 h-7 w-24 rounded bg-muted" />
        <div className="shimmer mt-2 h-3 w-32 rounded bg-muted" />
      </Card>
    );
  }

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && (
          <span
            className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', TONE_CLASSES[tone])}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>

      <div className="mt-1.5 flex items-center gap-2">
        {trend && <TrendPill {...trend} />}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </>
  );

  if (href) {
    return (
      <Card
        interactive
        className={cn('group relative', className)}
        // The link is an overlay so the whole card is clickable without nesting
        // interactive elements, which would break keyboard navigation.
      >
        {body}
        <Link href={href} className="absolute inset-0 rounded-xl" aria-label={`${label}: view details`}>
          <span className="sr-only">{label}</span>
        </Link>
        <ArrowRight
          className="absolute bottom-5 right-5 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </Card>
    );
  }

  return <Card className={className}>{body}</Card>;
}

/** Direction pill. `inverted` flips the colour logic for metrics where down is good. */
function TrendPill({
  value,
  label,
  inverted,
}: {
  value: number;
  label?: string;
  inverted?: boolean;
}) {
  const isFlat = value === 0;
  const isUp = value > 0;
  // A rise is good unless the metric is inverted (time-to-hire, no-show rate).
  const isGood = isFlat ? null : inverted ? !isUp : isUp;

  const Icon = isFlat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
        isGood === null && 'bg-muted text-muted-foreground',
        isGood === true && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
        isGood === false && 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {Math.abs(value)}%{label ? ` ${label}` : ''}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat grid                                                                  */
/* -------------------------------------------------------------------------- */

export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-4',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        columns === 4 && 'sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Compact metric                                                             */
/* -------------------------------------------------------------------------- */

/** A single metric with no card chrome — for use inside an existing card. */
export function Metric({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
