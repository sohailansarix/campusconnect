import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import { siteConfig } from '@/lib/site-config';
import './globals.css';

/**
 * Inter, self-hosted by next/font.
 *
 * `display: 'swap'` shows the fallback immediately rather than blocking on the
 * font file, and `variable` exposes it as a CSS custom property the Tailwind
 * config reads — so there is one place the font is declared.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  // `template` appends the product name to every page title, so a page only sets
  // its own segment.
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    'college events',
    'campus placements',
    'career readiness',
    'student portfolio',
    'verified certificates',
    'internships',
    'campus recruitment',
  ],
  authors: [{ name: siteConfig.name }],
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  robots: {
    // The app is not indexable; marketing pages opt in individually via their own
    // metadata. Without this, a shared passport link would end up in search.
    index: false,
    follow: false,
  },
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Zoom is deliberately not capped — disabling pinch-zoom is an accessibility
  // failure, and the layout is responsive enough not to need it.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        {/*
          `suppressHydrationWarning` on <html> is required by next-themes: the theme
          class is applied by a blocking script before React hydrates, which React
          would otherwise report as a mismatch.
        */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
