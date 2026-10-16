'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarDays, ChevronDown, LayoutDashboard, LogOut, Menu, Moon, Search,
  Settings, Sun, User, X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { MARKETING_NAV, SEARCH_SUGGESTIONS, siteConfig } from '@/lib/site-config';
import { useSession } from '@/lib/session';
import { cn, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/layout/logo';

/**
 * Marketing navbar.
 *
 * Two behaviours worth noting:
 *
 *  * **The search bar is a real input, not decoration.** On submit it routes to
 *    `/search`, which is where a student would expect a college site to send them.
 *    The suggestion chips exist because an empty search box on a marketing page
 *    gets used far less than one that shows what is searchable.
 *
 *  * **The mobile menu closes on navigation.** A menu that stays open after a route
 *    change reads as a broken page.
 */
export function MarketingNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useSession();
  const { theme, setTheme } = useTheme();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [scrolled, setScrolled] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Close the mobile menu whenever the route changes.
  React.useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  // Add a border once the page is scrolled, so the navbar separates from content
  // without a hard line at the top of the hero.
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    setSearchOpen(false);
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur-md transition-shadow',
        scrolled ? 'border-border shadow-soft' : 'border-transparent',
      )}
    >
      <div className="container flex h-16 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${siteConfig.name} home`}>
          <Logo className="h-7 w-7" />
          <span className="text-[17px] font-bold tracking-tight">
            Campus<span className="text-primary">Connect</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Main">
          {MARKETING_NAV.map((item) => {
            const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Expanding search — desktop only, where there is room for it. */}
          <form onSubmit={handleSearch} className="relative hidden lg:block">
            <label htmlFor="site-search" className="sr-only">
              Search events, courses and jobs
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              id="site-search"
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search events, courses, jobs…"
              list="search-suggestions"
              className={cn(
                'h-10 rounded-lg border border-input bg-background pl-9 pr-3 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                searchOpen ? 'w-72' : 'w-56',
              )}
            />
            {/* Native datalist keeps this dependency-free and works with a screen reader. */}
            <datalist id="search-suggestions">
              {SEARCH_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </form>

          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <Sun className="size-4 dark:hidden" aria-hidden="true" />
            <Moon className="hidden size-4 dark:block" aria-hidden="true" />
          </button>

          {user ? (
            <UserMenu name={user.fullName} role={user.role} onSignOut={() => void signOut()} />
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">Get Started</Link>
              </Button>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div id="mobile-menu" className="border-t border-border bg-background lg:hidden">
          <nav className="container space-y-1 py-4" aria-label="Mobile">
            <form onSubmit={handleSearch} className="relative pb-3">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events, courses, jobs…"
                aria-label="Search"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </form>

            {MARKETING_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}

            <div className="cc-divider my-3" />

            {user ? (
              <>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-accent"
                >
                  <LayoutDashboard className="size-4" aria-hidden="true" />
                  Dashboard
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </button>
              </>
            ) : (
              <div className="grid gap-2 pt-1">
                <Button asChild variant="outline">
                  <Link href="/login">Login</Link>
                </Button>
                <Button asChild>
                  <Link href="/register">Get Started</Link>
                </Button>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* User menu                                                                  */
/* -------------------------------------------------------------------------- */

function UserMenu({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — both expected of a menu like this.
  React.useEffect(() => {
    if (!open) return;

    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !open)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-accent"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {initials(name)}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Account menu for {name}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 animate-fade-in-fast overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lifted"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs capitalize text-muted-foreground">{role.replace(/_/g, ' ').toLowerCase()}</p>
          </div>

          <div className="cc-divider" />

          <MenuLink href="/dashboard" icon={<LayoutDashboard className="size-4" />} label="Dashboard" />
          <MenuLink href="/dashboard/profile" icon={<User className="size-4" />} label="My profile" />
          <MenuLink href="/dashboard/events" icon={<CalendarDays className="size-4" />} label="My events" />
          <MenuLink href="/dashboard/settings" icon={<Settings className="size-4" />} label="Settings" />

          <div className="cc-divider" />

          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
    >
      {icon}
      {label}
    </Link>
  );
}
