import { cn } from '@/lib/utils';

/**
 * The CampusConnect mark.
 *
 * A graduation cap fused with a rising bar chart — the product's two halves in one
 * glyph. Drawn as inline SVG so it inherits `currentColor` and needs no asset
 * pipeline; a favicon file mirrors it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn('text-primary', className)}
      role="img"
      aria-label="CampusConnect"
    >
      {/* Cap */}
      <path
        d="M16 4 3 10.5l13 6.5 13-6.5L16 4Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {/* Rising bars beneath the cap — the career half of the mark. */}
      <path d="M9 19.5v5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M16 19.5v8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M23 19.5v3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Tassel */}
      <path
        d="M27.5 12.5v6.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

/** Wordmark with the mark, for denser footers and email shells. */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo className="h-6 w-6" />
      <span className="text-base font-bold tracking-tight">
        Campus<span className="text-primary">Connect</span>
      </span>
    </span>
  );
}
