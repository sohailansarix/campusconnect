'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Progress bar.
 *
 * The `tone` variants map onto the readiness bands, so a progress bar for a
 * readiness pillar uses the same colour the score badge does.
 *
 * Always renders `role="progressbar"` with an accessible name, because a bar with
 * no label is invisible to a screen reader.
 */
const progressVariants = cva('h-full w-full flex-1 transition-all duration-500 ease-out', {
  variants: {
    tone: {
      default: 'bg-primary',
      success: 'bg-emerald-500',
      warning: 'bg-amber-500',
      danger: 'bg-red-500',
      info: 'bg-blue-500',
      purple: 'bg-violet-500',
      teal: 'bg-teal-500',
    },
  },
  defaultVariants: { tone: 'default' },
});

const progressRootVariants = cva('relative w-full overflow-hidden rounded-full bg-muted', {
  variants: {
    size: {
      sm: 'h-1.5',
      default: 'h-2',
      lg: 'h-3',
    },
  },
  defaultVariants: { size: 'default' },
});

export interface ProgressProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof progressVariants>,
    VariantProps<typeof progressRootVariants> {
  value: number;
  /** Accessible label. Falls back to a generic one rather than omitting it. */
  label?: string;
  /** Renders the percentage inside the track. Only for `size="lg"`. */
  showValue?: boolean;
  indeterminate?: boolean;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, tone, size, label, showValue, indeterminate, ...props }, ref) => {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        // Omitting aria-valuenow signals an indeterminate bar, which is correct.
        aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
        aria-label={label ?? 'Progress'}
        className={cn(progressRootVariants({ size }), className)}
        {...props}
      >
        <div
          className={cn(
            progressVariants({ tone }),
            indeterminate && 'animate-pulse',
            // A tiny non-zero value still renders a visible sliver, so a student
            // whose score is 2 can see it rather than an empty track.
            clamped > 0 && clamped < 2 && 'min-w-[4px]',
          )}
          style={{ width: `${indeterminate ? 40 : clamped}%` }}
        />
        {showValue && size === 'lg' && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white mix-blend-difference">
            {Math.round(clamped)}%
          </span>
        )}
      </div>
    );
  },
);
Progress.displayName = 'Progress';

/* -------------------------------------------------------------------------- */
/* Labelled progress row                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A progress bar with a label and value above it — the shape used for every
 * readiness pillar, roadmap step and course completion in the product.
 */
export interface ProgressRowProps {
  label: string;
  value: number;
  hint?: string;
  tone?: ProgressProps['tone'];
  size?: ProgressProps['size'];
  className?: string;
  /** Custom value label; defaults to a percentage. */
  valueLabel?: string;
}

function ProgressRow({ label, value, hint, tone, size, className, valueLabel }: ProgressRowProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium leading-none">{label}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {valueLabel ?? `${Math.round(value)}%`}
        </span>
      </div>
      <Progress value={value} tone={tone} size={size} label={label} />
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Multi-segment bar                                                          */
/* -------------------------------------------------------------------------- */

export interface ProgressSegment {
  label: string;
  value: number;
  tone: ProgressProps['tone'];
}

/**
 * Stacked segments in one track.
 *
 * Used for the readiness breakdown on the passport when the four pillars need to
 * read as parts of one whole rather than four separate bars.
 */
function SegmentedProgress({ segments, className }: { segments: ProgressSegment[]; className?: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const normalised = total > 0 ? segments.map((s) => ({ ...s, pct: (s.value / total) * 100 })) : segments.map((s) => ({ ...s, pct: 0 }));

  return (
    <div
      className={cn('flex h-3 w-full overflow-hidden rounded-full bg-muted', className)}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${Math.round(s.value)}`).join(', ')}
    >
      {normalised.map((segment) => (
        <div
          key={segment.label}
          className={cn(progressVariants({ tone: segment.tone }), 'first:rounded-l-full last:rounded-r-full')}
          style={{ width: `${segment.pct}%` }}
          title={`${segment.label}: ${Math.round(segment.value)}`}
        />
      ))}
    </div>
  );
}

export { Progress, ProgressRow, SegmentedProgress, progressVariants };
export { Slot };
