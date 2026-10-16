'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Award, BadgeCheck, Bell, Briefcase, Building2, CalendarDays, ChevronLeft, FileText,
  GraduationCap, LayoutDashboard, LineChart, Menu, Moon, ScanLine, Settings, Shield,
  Sun, Target, Users, X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { roleHasPermission, type Permission } from '@campusconnect/shared';
import { useSession } from '@/lib/session';
import { cn, initials } from '@/lib/utils';
import { Logo } from '@/components/layout/logo';
import { useUnreadCount } from '@/hooks/use-notifications';

/**
 * Dashboard shell.
 *
 * Navigation is derived from the RBAC matrix rather than from a hard-coded
 * per-role menu. A club lead adding `event:create` to their permissions sees the
 * organiser section appear; nobody has to remember to update two lists.
 *
 * The sidebar is a slide-over on mobile and fixed on desktop. That is the right
 * trade for a student checking their next event on a phone — a permanent sidebar
 * would eat a third of the viewport.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Any one of these grants visibility. A super admin passes everything. */
  permissions?: Permission[];
  badge?: 'notifications' | number;
  /** Marks a link active for the whole subtree rather than an exact match. */
  exact?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, signOut } = useSession();
  const { theme, setTheme } = useTheme();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const unreadCount = useUnreadCount(Boolean(user));

  // Restore the collapsed preference so a user's choice survives navigation.
  React.useEffect(() => {
    const stored = window.localStorage.getItem('cc-sidebar-collapsed');
    if (stored === 'true') setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      window.localStorage.setItem('cc-sidebar-collapsed', String(!value));
      return !value;
    });
  };

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const sections = React.useMemo(() => (user ? buildNav(user.role) : []), [user]);

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Skip link */}
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-background transition-all duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          collapsed ? 'lg:w-[68px]' : 'lg:w-64',
          'w-72',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
          <Link href="/" className="flex items-center gap-2 overflow-hidden" aria-label="CampusConnect home">
            <Logo className="h-7 w-7 shrink-0" />
            {!collapsed && (
              <span className="truncate text-[15px] font-bold tracking-tight">
                Campus<span className="text-primary">Connect</span>
              </span>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Dashboard">
          {loading ? (
            <NavSkeleton />
          ) : (
            sections.map((section) => (
              <div key={section.title} className="mb-5">
                {!collapsed && (
                  <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.title}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        item={item}
                        active={isActive(pathname, item)}
                        collapsed={collapsed}
                        unreadCount={unreadCount}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-border p-3">
          {user && (
            <div className={cn('flex items-center gap-2.5 rounded-lg p-2', !collapsed && 'bg-muted/50')}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(user.fullName)}
              </span>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{user.fullName}</p>
                  <p className="truncate text-[11px] capitalize text-muted-foreground">
                    {user.role.replace(/_/g, ' ').toLowerCase()}
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={toggleCollapsed}
            className="mt-2 hidden w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft className={cn('size-3.5 transition-transform', collapsed && 'rotate-180')} />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <Sun className="size-4 dark:hidden" />
              <Moon className="hidden size-4 dark:block" />
            </button>

            <Link
              href="/dashboard/notifications"
              className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <Bell className="size-4" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>

            {user && (
              <button
                type="button"
                onClick={() => void signOut()}
                className="ml-1 hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:block"
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        <main id="dashboard-main" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation model                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Builds the nav for a role.
 *
 * Every item declares a permission rather than a role. That is what makes the
 * matrix in `@campusconnect/shared` the single source of truth: changing who can
 * approve events changes both the API guard and this menu.
 */
export function buildNav(role: Parameters<typeof roleHasPermission>[0]): NavSection[] {
  const all = (permissions: Permission[]) => permissions.every((p) => roleHasPermission(role, p));
  const any = (permissions: Permission[]) => permissions.some((p) => roleHasPermission(role, p));

  const sections: NavSection[] = [];

  /* --- Always: the personal surface ------------------------------------- */
  const personal: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="size-4" />, exact: true },
    { label: 'My Events', href: '/dashboard/events', icon: <CalendarDays className="size-4" /> },
    { label: 'Notifications', href: '/dashboard/notifications', icon: <Bell className="size-4" />, badge: 'notifications' },
    { label: 'Settings', href: '/dashboard/settings', icon: <Settings className="size-4" /> },
  ];
  sections.push({ title: 'You', items: personal });

  /* --- Student ----------------------------------------------------------- */
  if (any(['passport:read_own', 'assessment:take', 'course:enroll', 'job:apply'])) {
    sections.push({
      title: 'Your career',
      items: [
        { label: 'Career Passport', href: '/dashboard/passport', icon: <BadgeCheck className="size-4" /> },
        { label: 'Skills', href: '/dashboard/skills', icon: <Target className="size-4" /> },
        { label: 'Courses', href: '/dashboard/courses', icon: <GraduationCap className="size-4" /> },
        { label: 'Projects', href: '/dashboard/projects', icon: <FileText className="size-4" /> },
        { label: 'Certificates', href: '/dashboard/certificates', icon: <Award className="size-4" /> },
        { label: 'Internships', href: '/dashboard/internships', icon: <Briefcase className="size-4" /> },
        { label: 'Applications', href: '/dashboard/applications', icon: <Target className="size-4" /> },
      ],
    });
  }

  /* --- Organiser --------------------------------------------------------- */
  if (any(['event:create', 'event:approve_faculty', 'event:manage_attendance'])) {
    sections.push({
      title: 'Organise',
      items: [
        { label: 'My Events', href: '/dashboard/organizer/events', icon: <CalendarDays className="size-4" /> },
        { label: 'Scan Attendance', href: '/dashboard/organizer/scan', icon: <ScanLine className="size-4" /> },
        { label: 'Clubs', href: '/dashboard/organizer/clubs', icon: <Users className="size-4" /> },
        ...(any(['event:approve_faculty', 'event:approve_admin'])
          ? [{ label: 'Approvals', href: '/dashboard/organizer/approvals', icon: <BadgeCheck className="size-4" /> }]
          : []),
        ...(all(['certificate:issue'])
          ? [{ label: 'Certificates', href: '/dashboard/organizer/certificates', icon: <Award className="size-4" /> }]
          : []),
      ],
    });
  }

  /* --- College admin ----------------------------------------------------- */
  if (any(['analytics:read_college'])) {
    sections.push({
      title: 'Institution',
      items: [
        { label: 'Overview', href: '/dashboard/college', icon: <Building2 className="size-4" />, exact: true },
        { label: 'Engagement', href: '/dashboard/college/engagement', icon: <LineChart className="size-4" /> },
        { label: 'Readiness', href: '/dashboard/college/placement', icon: <Target className="size-4" /> },
        { label: 'Students', href: '/dashboard/college/students', icon: <Users className="size-4" /> },
        { label: 'Departments', href: '/dashboard/college/departments', icon: <Building2 className="size-4" /> },
      ],
    });
  }

  /* --- Trainer / mentor -------------------------------------------------- */
  if (any(['project:review', 'course:manage', 'interview:conduct'])) {
    sections.push({
      title: 'Mentor',
      items: [
        { label: 'Review queue', href: '/dashboard/mentor', icon: <FileText className="size-4" />, exact: true },
        { label: 'Courses', href: '/dashboard/mentor/courses', icon: <GraduationCap className="size-4" /> },
        { label: 'Interviews', href: '/dashboard/mentor/interviews', icon: <Users className="size-4" /> },
      ],
    });
  }

  /* --- Employer ---------------------------------------------------------- */
  if (any(['job:create', 'candidate:search', 'application:read_employer'])) {
    sections.push({
      title: 'Hiring',
      items: [
        { label: 'Overview', href: '/dashboard/employer', icon: <LayoutDashboard className="size-4" />, exact: true },
        { label: 'Postings', href: '/dashboard/employer/jobs', icon: <Briefcase className="size-4" /> },
        { label: 'Pipeline', href: '/dashboard/employer/pipeline', icon: <Target className="size-4" /> },
        { label: 'Candidates', href: '/dashboard/employer/candidates', icon: <Users className="size-4" /> },
        { label: 'Interviews', href: '/dashboard/employer/interviews', icon: <CalendarDays className="size-4" /> },
      ],
    });
  }

  /* --- Platform ---------------------------------------------------------- */
  if (any(['analytics:read_platform', 'college:create', 'moderation:manage'])) {
    sections.push({
      title: 'Platform',
      items: [
        { label: 'Overview', href: '/dashboard/admin', icon: <Shield className="size-4" />, exact: true },
        { label: 'Colleges', href: '/dashboard/admin/colleges', icon: <Building2 className="size-4" /> },
        { label: 'Employers', href: '/dashboard/admin/employers', icon: <Briefcase className="size-4" /> },
        { label: 'Audit log', href: '/dashboard/admin/audit', icon: <FileText className="size-4" /> },
      ],
    });
  }

  return sections;
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({
  item,
  active,
  collapsed,
  unreadCount,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  unreadCount: number;
}) {
  const showBadge = item.badge === 'notifications' && unreadCount > 0;
  const numericBadge = typeof item.badge === 'number' ? item.badge : null;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        collapsed && 'justify-center px-2',
      )}
    >
      <span className="shrink-0 [&_svg]:size-4">{item.icon}</span>

      {!collapsed && <span className="truncate">{item.label}</span>}

      {showBadge && (
        <span
          className={cn(
            'flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white',
            collapsed ? 'absolute right-1 top-1' : 'ml-auto',
          )}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}

      {numericBadge !== null && numericBadge > 0 && !showBadge && (
        <span
          className={cn(
            'flex min-w-[18px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold leading-4 text-muted-foreground',
            collapsed ? 'absolute right-1 top-1' : 'ml-auto',
          )}
        >
          {numericBadge}
        </span>
      )}
    </Link>
  );
}

function NavSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <span className="sr-only">Loading navigation…</span>
      {[0, 1].map((group) => (
        <div key={group} className="space-y-1.5">
          <div className="shimmer mx-3 h-2.5 w-16 rounded bg-muted" />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="shimmer mx-1 h-9 rounded-lg bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}
