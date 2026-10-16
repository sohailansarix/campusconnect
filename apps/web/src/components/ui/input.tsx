import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Input.
 *
 * `aria-invalid` is driven by the `invalid` prop rather than by a class alone, so
 * a screen reader announces the error state instead of only a red border.
 */
const inputVariants = cva(
  'flex w-full rounded-lg border bg-background px-3 py-2 text-sm shadow-soft transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-11',
        sm: 'h-9 text-[13px]',
        lg: 'h-12 text-base',
      },
      invalid: {
        true: 'border-destructive focus-visible:ring-destructive',
        false: 'border-input',
      },
    },
    defaultVariants: { size: 'default', invalid: false },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  /** Leading icon, rendered inside the field. */
  icon?: React.ReactNode;
  /** Trailing slot — a clear button, a unit label, a toggle. */
  trailing?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size, invalid, icon, trailing, ...props }, ref) => {
    if (!icon && !trailing) {
      return (
        <input
          ref={ref}
          type={type}
          aria-invalid={invalid || undefined}
          className={cn(inputVariants({ size, invalid, className }))}
          {...props}
        />
      );
    }

    return (
      <div className="relative flex items-center">
        {icon && (
          <span className="pointer-events-none absolute left-3 flex text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          type={type}
          aria-invalid={invalid || undefined}
          className={cn(
            inputVariants({ size, invalid }),
            icon && 'pl-10',
            trailing && 'pr-10',
            className,
          )}
          {...props}
        />
        {trailing && <span className="absolute right-3 flex items-center">{trailing}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      'flex min-h-[96px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-soft placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
      invalid && 'border-destructive focus-visible:ring-destructive',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/* -------------------------------------------------------------------------- */
/* Field wrapper                                                              */
/* -------------------------------------------------------------------------- */

export interface FieldProps {
  label?: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + control + error + hint, wired for accessibility.
 *
 * The error is rendered with `role="alert"` so it is announced when it appears,
 * and the hint is associated via `aria-describedby` by the caller passing matching
 * ids — the ids are derived from `htmlFor` so a form does not have to invent them.
 */
function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
          {required && (
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Search input                                                               */
/* -------------------------------------------------------------------------- */

export interface SearchInputProps extends Omit<InputProps, 'icon' | 'type'> {
  onClear?: () => void;
}

/**
 * Search field with a clear affordance. Rendered as `type="search"` so mobile
 * keyboards show a search key rather than a return key.
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, onClear, value, ...props }, ref) => (
    <Input
      ref={ref}
      type="search"
      value={value}
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      }
      trailing={
        value && onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Clear search"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : undefined
      }
      className={className}
      {...props}
    />
  ),
);
SearchInput.displayName = 'SearchInput';

export { Input, Textarea, Field, SearchInput, inputVariants };
