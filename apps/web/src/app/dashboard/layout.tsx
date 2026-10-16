import { DashboardShell } from '@/components/layout/dashboard-shell';

/**
 * Dashboard route group layout.
 *
 * A server component so the shell's children can be server-rendered where useful.
 * `DashboardShell` is itself a client component — it needs the pathname and the
 * session — but wrapping does not force the page below it to be one.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
