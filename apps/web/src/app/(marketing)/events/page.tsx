'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CalendarDays, Clock, Filter, Grid3x3, LayoutList, MapPin, Search, Users, Video, X,
} from 'lucide-react';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS, type EventCategory } from '@campusconnect/shared';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CardListSkeleton, EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useDebounced, useList } from '@/hooks/use-api';
import { cn, formatCountdown, formatCurrency, formatEventDate, pluralise } from '@/lib/utils';

/**
 * Event discovery.
 *
 * Two views over one query: a list for scanning and a calendar for planning.
 * Filters live in a collapsible panel on mobile and a persistent sidebar on
 * desktop — a filter bar with eight controls above the results pushes the actual
 * results off a phone screen entirely.
 */

type EventCard = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: EventCategory;
  mode: string;
  status: string;
  bannerUrl: string | null;
  venue: string | null;
  meetingUrl: string | null;
  startAt: string;
  endAt: string;
  registrationDeadline: string | null;
  capacity: number;
  fee: number;
  currency: string;
  registrationCount: number;
  waitlistCount: number;
  averageRating: string | null;
  club: { id: string; name: string; logoUrl: string | null } | null;
  viewerRegistration: { id: string; status: string } | null;
};

const MODE_LABELS: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE: 'In person',
  HYBRID: 'Hybrid',
};

export default function EventsPage() {
  const list = useList<EventCard>('/events', { initialParams: { upcomingOnly: true, sortBy: 'startAt', sortOrder: 'asc' } });

  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebounced(search, 400);

  const [view, setView] = React.useState<'list' | 'calendar'>('list');
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  // Push the debounced search into the query. Kept separate from the filter patch
  // so a fast typist does not trigger a request per keystroke.
  React.useEffect(() => {
    list.setFilter({ search: debouncedSearch || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const activeCategory = (list.params.category as string | undefined) ?? '';
  const activeMode = (list.params.mode as string | undefined) ?? '';
  const freeOnly = list.params.free === true;

  const activeFilterCount = [activeCategory, activeMode, freeOnly].filter(Boolean).length;

  return (
    <div className="container py-10 lg:py-14">
      {/* --- Header ------------------------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Events</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Workshops, competitions and club activities across your campus. Attend, and your
            certificate is issued automatically — it becomes part of your Career Passport.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={view === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
          >
            <LayoutList className="size-4" aria-hidden="true" />
            List
          </Button>
          <Button
            variant={view === 'calendar' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('calendar')}
            aria-pressed={view === 'calendar'}
          >
            <Grid3x3 className="size-4" aria-hidden="true" />
            Calendar
          </Button>
        </div>
      </div>

      {/* --- Controls ----------------------------------------------------- */}
      <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Search by title, topic or tag…"
            aria-label="Search events"
          />
        </div>

        <Button
          variant="outline"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className="justify-between lg:w-auto"
        >
          <span className="flex items-center gap-2">
            <Filter className="size-4" aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </span>
        </Button>
      </div>

      {/* --- Filter panel ------------------------------------------------- */}
      {filtersOpen && (
        <Card className="mt-4 animate-fade-in" padding="sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label htmlFor="filter-category" className="text-xs font-medium">
                Category
              </label>
              <Select
                id="filter-category"
                value={activeCategory}
                onChange={(value) => list.setFilter({ category: value || undefined })}
                placeholder="All categories"
                options={EVENT_CATEGORIES.map((category) => ({
                  value: category,
                  label: EVENT_CATEGORY_LABELS[category],
                }))}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="filter-mode" className="text-xs font-medium">
                Format
              </label>
              <Select
                id="filter-mode"
                value={activeMode}
                onChange={(value) => list.setFilter({ mode: value || undefined })}
                placeholder="Any format"
                options={[
                  { value: 'OFFLINE', label: 'In person' },
                  { value: 'ONLINE', label: 'Online' },
                  { value: 'HYBRID', label: 'Hybrid' },
                ]}
              />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium">Price</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => list.setFilter({ free: freeOnly ? undefined : true })}
                  aria-pressed={freeOnly}
                  className={cn(
                    'h-11 flex-1 rounded-lg border text-sm font-medium transition-colors',
                    freeOnly
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input bg-background hover:bg-accent',
                  )}
                >
                  Free only
                </button>
              </div>
            </div>

            <div className="flex items-end">
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  list.resetFilters();
                  setSearch('');
                }}
                disabled={!list.hasFilters && !search}
              >
                <X className="size-4" aria-hidden="true" />
                Clear all
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* --- Results ------------------------------------------------------ */}
      <div className="mt-6">
        {list.loading ? (
          <CardListSkeleton count={5} />
        ) : list.error ? (
          <ErrorState
            title="Could not load events"
            description={list.error}
            requestId={list.requestId}
            onRetry={() => void list.refetch()}
          />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title={list.hasFilters ? 'No events match those filters' : 'No upcoming events'}
            description={
              list.hasFilters
                ? 'Try widening your search — remove a filter or clear the search term.'
                : 'New events are added regularly. Check back soon, or follow your clubs to hear first.'
            }
            action={
              list.hasFilters ? (
                <Button
                  onClick={() => {
                    list.resetFilters();
                    setSearch('');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/clubs">Browse clubs</Link>
                </Button>
              )
            }
          />
        ) : view === 'list' ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {list.meta?.total ?? list.items.length} {pluralise(list.meta?.total ?? list.items.length, 'event')}
            </p>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.items.map((event) => (
                <li key={event.id}>
                  <EventListCard event={event} />
                </li>
              ))}
            </ul>

            <Pagination
              meta={list.meta}
              onNext={list.nextPage}
              onPrevious={list.previousPage}
              loading={list.loading}
            />
          </>
        ) : (
          <CalendarView events={list.items} />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Event card                                                                 */
/* -------------------------------------------------------------------------- */

export function EventListCard({ event }: { event: EventCard }) {
  const seatsRemaining = event.capacity === 0 ? null : Math.max(0, event.capacity - event.registrationCount);
  const isFull = seatsRemaining === 0;
  const started = new Date(event.startAt) <= new Date();

  return (
    <Card interactive className="flex h-full flex-col overflow-hidden p-0">
      <Link href={`/events/${event.slug}`} className="flex flex-1 flex-col">
        {/* Banner or a category-coloured placeholder. A missing image should never
            leave a broken frame, so the fallback is designed rather than blank. */}
        <div className="relative h-36 shrink-0 overflow-hidden bg-gradient-to-br from-layer-campus-100 to-layer-campus-50 dark:from-layer-campus-950 dark:to-layer-campus-900/40">
          {event.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.bannerUrl}
              alt=""
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <CalendarDays className="size-10 text-layer-campus-400/60" aria-hidden="true" />
            </div>
          )}

          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm">
              {EVENT_CATEGORY_LABELS[event.category]}
            </Badge>
          </div>

          <div className="absolute right-3 top-3">
            <Badge
              variant={event.fee === 0 ? 'success' : 'default'}
              className="bg-background/90 backdrop-blur-sm"
            >
              {formatCurrency(event.fee, event.currency)}
            </Badge>
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{event.title}</h3>

          {event.club && (
            <p className="mt-1 truncate text-xs text-muted-foreground">by {event.club.name}</p>
          )}

          <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              <dt className="sr-only">Starts</dt>
              <dd>{formatEventDate(event.startAt)}</dd>
            </div>

            <div className="flex items-center gap-1.5">
              {event.mode === 'ONLINE' ? (
                <Video className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <dt className="sr-only">Where</dt>
              <dd className="truncate">
                {event.mode === 'ONLINE' ? 'Online' : (event.venue ?? 'Venue to be confirmed')}
              </dd>
            </div>

            {event.capacity > 0 && (
              <div className="flex items-center gap-1.5">
                <Users className="size-3.5 shrink-0" aria-hidden="true" />
                <dt className="sr-only">Capacity</dt>
                <dd>
                  {event.registrationCount} of {event.capacity} registered
                  {isFull && event.waitlistCount > 0 ? ' · waitlist open' : ''}
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
            {event.viewerRegistration ? (
              <StatusBadge status={event.viewerRegistration.status} size="sm" />
            ) : started ? (
              <Badge variant="neutral" size="sm">
                Ended
              </Badge>
            ) : isFull ? (
              <Badge variant="warning" size="sm">
                Full
              </Badge>
            ) : (
              <Badge variant="info" size="sm">
                {formatCountdown(event.startAt)}
              </Badge>
            )}

            {event.averageRating && Number(event.averageRating) > 0 && (
              <Badge variant="neutral" size="sm">
                ★ {Number(event.averageRating).toFixed(1)}
              </Badge>
            )}
          </div>
        </div>
      </Link>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendar view                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Groups the current page of events by day.
 *
 * Honest limitation: this groups what the list query returned rather than fetching
 * a whole month, so a month with more events than `pageSize` shows a partial view.
 * The API's `/events/calendar` endpoint exists for the full-month case and is used
 * by the dashboard's month widget. TODO(Phase 2): switch this view to it.
 */
function CalendarView({ events }: { events: EventCard[] }) {
  const grouped = React.useMemo(() => {
    const map = new Map<string, EventCard[]>();

    for (const event of events) {
      const key = new Date(event.startAt).toDateString();
      const bucket = map.get(key) ?? [];
      bucket.push(event);
      map.set(key, bucket);
    }

    return [...map.entries()].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  }, [events]);

  if (grouped.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="Nothing scheduled"
        description="No events match your current filters."
      />
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([day, dayEvents]) => (
        <section key={day}>
          <h2 className="sticky top-16 z-10 -mx-1 bg-background/95 px-1 py-2 text-sm font-semibold backdrop-blur-sm">
            {new Date(day).toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            <span className="ml-2 font-normal text-muted-foreground">
              {dayEvents.length} {pluralise(dayEvents.length, 'event')}
            </span>
          </h2>

          <ul className="mt-3 space-y-3">
            {dayEvents
              .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
              .map((event) => (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.slug}`}
                    className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-soft transition-colors hover:bg-accent/40"
                  >
                    <div className="w-16 shrink-0 text-center">
                      <p className="text-sm font-semibold tabular-nums">
                        {new Date(event.startAt).toLocaleTimeString('en-IN', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>

                    <div className="min-w-0 flex-1 border-l border-border pl-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-medium">{event.title}</h3>
                        <Badge variant="neutral" size="sm">
                          {EVENT_CATEGORY_LABELS[event.category]}
                        </Badge>
                        {event.viewerRegistration && (
                          <StatusBadge status={event.viewerRegistration.status} size="sm" />
                        )}
                      </div>

                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {MODE_LABELS[event.mode] ?? event.mode}
                        {event.venue ? ` · ${event.venue}` : ''}
                        {' · '}
                        {formatCurrency(event.fee, event.currency)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export function Pagination({
  meta,
  onNext,
  onPrevious,
  loading,
}: {
  meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean } | null;
  onNext: () => void;
  onPrevious: () => void;
  loading?: boolean;
}) {
  if (!meta || meta.totalPages <= 1) return null;

  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-between gap-4" aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{' '}
        <span className="font-medium text-foreground">{meta.total}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={!meta.hasPrev || loading}>
          Previous
        </Button>
        <span className="px-2 text-sm text-muted-foreground">
          Page {meta.page} of {meta.totalPages}
        </span>
        <Button variant="outline" size="sm" onClick={onNext} disabled={!meta.hasNext || loading}>
          Next
        </Button>
      </div>
    </nav>
  );
}
