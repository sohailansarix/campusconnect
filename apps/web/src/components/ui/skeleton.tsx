import { cn } from '@/lib/utils';

/**
 * Skeleton.
 *
 * A shimmering placeholder. `aria-hidden` because the surrounding container
 * announces "Loading…" once — a screen reader should not read twelve empty boxes.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('shimmer rounded-md bg-muted', className)}
      {...props}
    />
  );
}
