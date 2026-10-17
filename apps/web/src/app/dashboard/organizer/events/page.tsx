'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, CalendarPlus, MapPin, Video } from 'lucide-react';
import { roleHasPermission } from '@campusconnect/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { apiList } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';

type ManagedEvent = { id: string; slug: string; title: string; category: string; mode: string; status: string; venue: string | null; startAt: string; endAt: string; registrationCount: number; attendanceCount: number; certificateEnabled: boolean };

export default function OrganizerEventsPage() {
  const { user } = useSession();
  const canCreate = Boolean(user && roleHasPermission(user.role, 'event:create'));
  const events = useAsync(async () => {
    const result = await apiList<ManagedEvent>('/events', { query: { page: 1, pageSize: 100, organizerId: user?.id, upcomingOnly: false, sortBy: 'startAt', sortOrder: 'desc' } });
    return result.data;
  }, { enabled: Boolean(user), deps: [user?.id] });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-primary">Event operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Managed events</h1><p className="mt-2 text-sm text-muted-foreground">Track approvals, registrations, attendance and certificate issuing.</p></div>{canCreate && <Button asChild><Link href="/dashboard/organizer/events/new"><CalendarPlus className="size-4" /> Create event</Link></Button>}</div>
      {events.loading ? <div className="space-y-3" aria-busy="true">{[0, 1, 2, 3].map((key) => <div key={key} className="shimmer h-28 rounded-xl bg-muted" />)}</div> : events.error ? <ErrorState title="Could not load events" description={events.error} requestId={events.requestId} onRetry={() => void events.refetch()} /> : events.data?.length ? <div className="space-y-3">{events.data.map((event) => <Card key={event.id} className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-xs text-muted-foreground">{event.category.replaceAll('_', ' ')}</span></div><h2 className="mt-2 truncate font-semibold">{event.title}</h2><p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />{formatDateTime(event.startAt)}</span><span className="inline-flex items-center gap-1">{event.mode === 'ONLINE' ? <Video className="size-3.5" /> : <MapPin className="size-3.5" />}{event.mode === 'ONLINE' ? 'Online' : event.venue ?? 'Venue TBD'}</span><span>{event.registrationCount} registered · {event.attendanceCount} attended</span></p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><Link href={`/events/${event.slug}`}>View event <ArrowRight className="size-3.5" /></Link></Button>{['PUBLISHED', 'ONGOING'].includes(event.status) && <Button size="sm" asChild><Link href={`/dashboard/organizer/scan?eventId=${event.id}`}>Scan attendance</Link></Button>}</div></Card>)}</div> : <EmptyState icon={<CalendarDays />} title="No managed events yet" description="Create an event and submit it for faculty or college approval." action={canCreate && <Button asChild><Link href="/dashboard/organizer/events/new">Create an event</Link></Button>} />}
    </div>
  );
}
