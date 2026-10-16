import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Badge.
 *
 * The `status` variants map 1:1 onto the platform's state machines (event status,
 * application status, certificate status) so a state is rendered consistently
 * wherever it appears — the colours become part of the mental model.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
        warning: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
        danger: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
        info: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
        purple: 'border-transparent bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
        neutral: 'border-transparent bg-muted text-muted-foreground',
        /** A verified/checked state — used for certificates and verified skills. */
        verified:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
      },
      size: {
        default: 'text-xs',
        sm: 'px-2 py-0 text-[11px]',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Status badge                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Maps a domain status string onto a badge variant and label.
 *
 * Centralised so adding a new status to the schema surfaces as a visible neutral
 * badge rather than a crash or a blank cell.
 */
const STATUS_MAP: Record<string, { variant: BadgeProps['variant']; label: string }> = {
  // Event lifecycle
  DRAFT: { variant: 'neutral', label: 'Draft' },
  PENDING_FACULTY: { variant: 'warning', label: 'Awaiting faculty' },
  PENDING_ADMIN: { variant: 'warning', label: 'Awaiting admin' },
  PUBLISHED: { variant: 'success', label: 'Published' },
  REJECTED: { variant: 'danger', label: 'Rejected' },
  ONGOING: { variant: 'info', label: 'Happening now' },
  COMPLETED: { variant: 'secondary', label: 'Completed' },
  CANCELLED: { variant: 'danger', label: 'Cancelled' },

  // Registration
  PENDING: { variant: 'warning', label: 'Pending' },
  CONFIRMED: { variant: 'success', label: 'Confirmed' },
  WAITLISTED: { variant: 'warning', label: 'Waitlisted' },
  ATTENDED: { variant: 'success', label: 'Attended' },
  NO_SHOW: { variant: 'neutral', label: 'No show' },

  // Certificates
  ISSUED: { variant: 'success', label: 'Issued' },
  REVOKED: { variant: 'danger', label: 'Revoked' },
  EXPIRED: { variant: 'neutral', label: 'Expired' },

  // Applications
  APPLIED: { variant: 'info', label: 'Applied' },
  UNDER_REVIEW: { variant: 'warning', label: 'Under review' },
  SHORTLISTED: { variant: 'purple', label: 'Shortlisted' },
  INTERVIEW_SCHEDULED: { variant: 'purple', label: 'Interview scheduled' },
  INTERVIEWED: { variant: 'purple', label: 'Interviewed' },
  OFFER: { variant: 'success', label: 'Offer' },
  HIRED: { variant: 'success', label: 'Hired' },
  WITHDRAWN: { variant: 'neutral', label: 'Withdrawn' },

  // Projects
  SUBMITTED: { variant: 'info', label: 'Submitted' },
  UNDER_REVIEW_PROJECT: { variant: 'warning', label: 'Under review' },
  APPROVED: { variant: 'success', label: 'Approved' },
  NEEDS_REVISION: { variant: 'warning', label: 'Needs revision' },

  // Accounts
  ACTIVE: { variant: 'success', label: 'Active' },
  SUSPENDED: { variant: 'danger', label: 'Suspended' },
  DEACTIVATED: { variant: 'neutral', label: 'Deactivated' },
  PENDING_INVITE: { variant: 'warning', label: 'Invitation pending' },
};

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: string;
  /** Shows a spinner for genuinely in-flight states. */
  loading?: boolean;
  showIcon?: boolean;
}

function StatusBadge({ status, loading, showIcon = false, className, ...props }: StatusBadgeProps) {
  const mapped = STATUS_MAP[status] ?? { variant: 'neutral' as const, label: status.replace(/_/g, ' ').toLowerCase() };

  return (
    <Badge variant={mapped.variant} className={cn('capitalize', className)} {...props}>
      {loading ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : showIcon && mapped.variant === 'success' ? (
        <Check className="size-3" aria-hidden="true" />
      ) : showIcon && mapped.variant === 'danger' ? (
        <X className="size-3" aria-hidden="true" />
      ) : null}
      {/* `capitalize` handles the fallback's lowercase; mapped labels are already cased. */}
      <span className={STATUS_MAP[status] ? undefined : 'capitalize'}>{mapped.label}</span>
    </Badge>
  );
}

export { Badge, StatusBadge, badgeVariants, STATUS_MAP };
