import { MarketingNavbar } from '@/components/layout/marketing-navbar';
import { MarketingFooter } from '@/components/layout/marketing-footer';

/**
 * Marketing route group layout.
 *
 * A route group `(marketing)` so these pages share the public chrome without
 * affecting the URL — `/events` renders inside this layout, and so does `/`.
 * Dashboard routes get their own shell with sidebar navigation.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip link: the first tab stop on every page, so a keyboard user can jump
          past the navbar without tabbing through six links. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <MarketingNavbar />

      <main id="main" className="flex-1">
        {children}
      </main>

      <MarketingFooter />
    </div>
  );
}
