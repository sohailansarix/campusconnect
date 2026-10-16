import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class merge: `cn('p-2', condition && 'p-4')` → `p-4`. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------------- */
/* Dates & numbers                                                            */
/* -------------------------------------------------------------------------- */

const IST = 'Asia/Kolkata';

/** "Sat, 14 Feb · 10:00 AM" — the format used on event cards. */
export function formatEventDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST,
  }).format(new Date(date));
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: IST,
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST,
  }).format(new Date(date));
}

/** "in 3 days" / "2 hours ago". Falls back to an absolute date beyond a month. */
export function formatRelative(date: string | Date): string {
  const target = new Date(date).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const abs = Math.abs(diffMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (abs < minute) return 'just now';
  if (abs < hour) return formatter.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return formatter.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return formatter.format(Math.round(diffMs / day), 'day');

  return formatDate(date);
}

/** Countdown label for an event that is about to start. */
export function formatCountdown(date: string | Date): string {
  const diffMs = new Date(date).getTime() - Date.now();
  if (diffMs <= 0) return 'Started';

  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(hours / 24);

  if (hours < 1) return 'Starting soon';
  if (hours < 24) return `in ${hours}h`;
  if (days === 1) return 'Tomorrow';
  if (days < 30) return `in ${days} days`;
  return formatDate(date);
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/** Rupees from minor units. `0` renders as "Free". */
export function formatCurrency(minorUnits: number | null | undefined, currency = 'INR'): string {
  if (minorUnits === null || minorUnits === undefined) return '—';
  if (minorUnits === 0) return 'Free';

  const amount = minorUnits / 100;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;

  if (amount >= 10_000_000) return `${symbol}${(amount / 10_000_000).toFixed(2)} Cr`;
  if (amount >= 100_000) return `${symbol}${(amount / 100_000).toFixed(2)} L`;

  return `${symbol}${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** "₹4.5 – 6.5 LPA" for a salary band. */
export function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = 'INR',
): string {
  if (!min && !max) return 'Not disclosed';
  if (min && max) return `${formatCurrency(min, currency)} – ${formatCurrency(max, currency)}`;
  return formatCurrency(min ?? max, currency);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-IN');
}

/** "1.2k" style compaction for tight stat tiles. */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

/* -------------------------------------------------------------------------- */
/* Strings                                                                    */
/* -------------------------------------------------------------------------- */

/** `IN_PROGRESS` → `In progress`. Used wherever an enum is shown to a person. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '';
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Strips a leading `www.` and protocol for a compact link label. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

/* -------------------------------------------------------------------------- */
/* Colours & bands                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Readiness tone. Kept in sync with `READINESS_BANDS` in the shared package by
 * consuming the same thresholds — these class strings are the only UI-side map.
 */
export function readinessClasses(score: number): { text: string; bg: string; border: string; ring: string } {
  if (score >= 80) {
    return {
      text: 'text-emerald-700 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      border: 'border-emerald-200 dark:border-emerald-900',
      ring: 'stroke-emerald-500',
    };
  }
  if (score >= 60) {
    return {
      text: 'text-blue-700 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      border: 'border-blue-200 dark:border-blue-900',
      ring: 'stroke-blue-500',
    };
  }
  if (score >= 40) {
    return {
      text: 'text-amber-700 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      border: 'border-amber-200 dark:border-amber-900',
      ring: 'stroke-amber-500',
    };
  }
  return {
    text: 'text-slate-700 dark:text-slate-300',
    bg: 'bg-slate-50 dark:bg-slate-900/60',
    border: 'border-slate-200 dark:border-slate-800',
    ring: 'stroke-slate-400',
  };
}

/** Layer accent classes, keyed by the layer in the shared package. */
export function layerClasses(layer: 'campusconnect' | 'skillbridge' | 'careerconnect') {
  switch (layer) {
    case 'campusconnect':
      return { text: 'text-layer-campus-700 dark:text-layer-campus-400', bg: 'bg-layer-campus-50 dark:bg-layer-campus-950/40', border: 'border-layer-campus-200 dark:border-layer-campus-900', solid: 'bg-layer-campus-600' };
    case 'skillbridge':
      return { text: 'text-layer-skill-700 dark:text-layer-skill-400', bg: 'bg-layer-skill-50 dark:bg-layer-skill-950/40', border: 'border-layer-skill-200 dark:border-layer-skill-900', solid: 'bg-layer-skill-600' };
    case 'careerconnect':
      return { text: 'text-layer-career-700 dark:text-layer-career-400', bg: 'bg-layer-career-50 dark:bg-layer-career-950/40', border: 'border-layer-career-200 dark:border-layer-career-900', solid: 'bg-layer-career-600' };
  }
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

/** Stable, readable initials-based avatar colour from a name. */
export function avatarColor(seed: string): string {
  const palette = [
    'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  ];

  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;

  return palette[hash % palette.length]!;
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** Joins class fragments, dropping falsy entries. */
export function classes(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

/** Debounce for search inputs, with cancel. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay = 300,
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const wrapped = (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return wrapped;
}
