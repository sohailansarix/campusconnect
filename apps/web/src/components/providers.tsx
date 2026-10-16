'use client';

import * as React from 'react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { SessionProvider } from '@/lib/session';

/**
 * Client providers.
 *
 * Kept in one place so the root layout can stay a server component — that matters
 * because the layout contributes metadata, and a `'use client'` layout cannot.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      // Light mode is the product default per the brief. `enableSystem` is on so a
      // user who has explicitly chosen dark at the OS level gets it on first visit.
      enableSystem
      disableTransitionOnChange
    >
      <SessionProvider>
        {children}

        <Toaster
          position="top-right"
          closeButton
          richColors
          // Toasts must be reachable by keyboard and must not trap focus on a page
          // a user is trying to use.
          toastOptions={{
            classNames: {
              toast: 'rounded-xl border border-border shadow-card',
            },
          }}
        />
      </SessionProvider>
    </ThemeProvider>
  );
}
