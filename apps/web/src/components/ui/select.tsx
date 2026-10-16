'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Native select, styled.
 *
 * A native element rather than a Radix listbox: on mobile it opens the OS picker,
 * which is faster and more familiar than a custom popover, and it works with a
 * screen reader without any ARIA plumbing. The styling is on the wrapping element
 * because a `<select>` cannot render a chevron itself.
 */
export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Rendered as a disabled first option. Omit for a required select. */
  placeholder?: string;
  invalid?: boolean;
  size?: 'sm' | 'default' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'h-9 text-[13px]',
  default: 'h-11 text-sm',
  lg: 'h-12 text-base',
} as const;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, value, onChange, options, placeholder, invalid, size = 'default', id, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full appearance-none rounded-lg border border-input bg-background py-2 pl-3 pr-9 shadow-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          SIZE_CLASSES[size],
          invalid && 'border-destructive focus-visible:ring-destructive',
          className,
        )}
        {...props}
      >
        {placeholder !== undefined && (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        )}

        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>

      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  ),
);
Select.displayName = 'Select';

/* -------------------------------------------------------------------------- */
/* Switch                                                                     */
/* -------------------------------------------------------------------------- */

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Toggle switch.
 *
 * Built as a `<button role="switch">` rather than a styled checkbox so the
 * on/off semantics are explicit and keyboard activation is `Space` or `Enter` by
 * default. The label is associated by id, not by wrapping, so the description can
 * sit between them.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
  className,
}: SwitchProps) {
  const labelId = id ? `${id}-label` : undefined;
  const descriptionId = id ? `${id}-description` : undefined;

  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      {(label || description) && (
        <div className="space-y-0.5">
          {label && (
            <label id={labelId} htmlFor={id} className="text-sm font-medium leading-tight">
              {label}
            </label>
          )}
          {description && (
            <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 transform rounded-full bg-background shadow-soft transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Checkbox                                                                   */
/* -------------------------------------------------------------------------- */

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
  indeterminate,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: string;
  disabled?: boolean;
  id?: string;
  indeterminate?: boolean;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // `indeterminate` is a DOM property with no HTML attribute, so it must be set
  // imperatively. Used by the "select all" checkbox in data tables.
  React.useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={description && id ? `${id}-description` : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {(label || description) && (
        <div className="space-y-0.5">
          {label && (
            <label htmlFor={id} className="cursor-pointer text-sm leading-tight">
              {label}
            </label>
          )}
          {description && (
            <p id={id ? `${id}-description` : undefined} className="text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
