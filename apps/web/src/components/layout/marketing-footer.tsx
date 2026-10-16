import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { MARKETING_FOOTER, PLACEHOLDER_NOTES, siteConfig } from '@/lib/site-config';

/**
 * Marketing footer.
 *
 * Carries the placeholder disclosure. The brief requires fake logos and
 * testimonials to be labelled, and the footer is where a reader looks for that —
 * putting it only next to the logo row would be easy to miss on a long page.
 */
export function MarketingFooter() {
  const year = new Date().getFullYear();

  const columns = [
    { title: 'Platform', links: MARKETING_FOOTER.platform },
    { title: 'Who it is for', links: MARKETING_FOOTER.audiences },
    { title: 'Company', links: MARKETING_FOOTER.company },
    { title: 'Legal', links: MARKETING_FOOTER.legal },
  ];

  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          {/* Brand */}
          <div className="space-y-4">
            <Logo />
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              {siteConfig.description}
            </p>

            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <a href={`mailto:${siteConfig.contact.email}`} className="hover:text-foreground hover:underline">
                  {siteConfig.contact.email}
                </a>
              </li>
              <li className="flex items-start gap-2">
                <Phone className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{siteConfig.contact.phone}</span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{siteConfig.contact.address}</span>
              </li>
            </ul>
          </div>

          {/* Link columns */}
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">{column.title}</h2>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Placeholder disclosure */}
        <div className="mt-12 rounded-lg border border-dashed border-border bg-background/60 p-4">
          <p className="text-xs font-medium text-foreground">Placeholder content notice</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {PLACEHOLDER_NOTES.logos} {PLACEHOLDER_NOTES.testimonials} Landing-page statistics
            are illustrative figures, not measured platform data.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            © {year} {siteConfig.name}. All rights reserved.
          </p>

          <p className="text-xs text-muted-foreground">
            Built for colleges in India.{' '}
            <Link href="/legal/data-consent" className="underline hover:text-foreground">
              How we handle student data
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
