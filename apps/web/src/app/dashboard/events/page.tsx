'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, QrCode, Ticket, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useList } from '@/hooks/use-api';
import { del } from '@/lib/api';
import { formatDateTime, formatCurrency } from '@/lib/utils';

type Registration = {
  id: string;
  status: string;
  passCode: string;
  waitlistPosition: number | null;
  registeredAt: string;
  attendance: { id: string; method: string; markedAt: string; revokedAt: string | null } | null;
  certificate: { certificateId: string; title: string; status: string; issuedAt: string } | null;
  event: {
    id: string;
    slug: string;
    title: string;
    category: string;
    mode: string;
    status: string;
    bannerUrl: string | null;
    venue: string | null;
    startAt: string;
    endAt: string;
    capacity: number;
    fee: number;
    certificateEnabled: boolean;
    club: { name: string } | null;
  };
};

export default function MyEventsPage() {
  const registrations = useList<Registration>('/events/mine/registrations', {
    initialParams: { pageSize: 50, sortBy: 'registeredAt', sortOrder: 'desc' },
  });
  const [cancelling, setCancelling] = React.useState<string | null>(null);

  const cancelRegistration = async (registration: Registration) => {
    setCancelling(registration.id);
    try {
      await del(`/events/registrations/${registration.id}`, { reason: 'Cancelled by the student' });
      toast.success('Registration cancelled');
      await registrations.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not cancel this registration');
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-medium text-primary">CampusConnect</p><h1 className="mt-1 text-2xl font-bold tracking-tight">My events</h1><p className="mt-2 text-sm text-muted-foreground">Your registrations, event passes, attendance and certificates in one place.</p></div>
        <Button variant="outline" asChild><Link href="/events">Discover events <ArrowRight className="size-4" /></Link></Button>
      </div>

      <div className="mt-7">
        {registrations.loading ? <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((key) => <div key={key} className="shimmer h-36 rounded-xl bg-muted" />)}</div> : registrations.error ? (
          <ErrorState title="Could not load your registrations" description={registrations.error} requestId={registrations.requestId} onRetry={() => void registrations.refetch()} />
        ) : registrations.items.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="Your event journey starts here" description="Register for a workshop, competition or club activity and your pass will appear here." action={<Button asChild><Link href="/events">Explore events</Link></Button>} />
        ) : (
          <div className="space-y-4">
            {registrations.items.map((registration) => {
              const canCancel = ['CONFIRMED', 'WAITLISTED', 'PENDING'].includes(registration.status) && !registration.attendance;
              return (
                <Card key={registration.id} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><StatusBadge status={registration.status} /><span className="text-xs text-muted-foreground">{registration.event.category.replaceAll('_', ' ')}</span></div>
                    <h2 className="mt-2 truncate text-base font-semibold"><Link className="hover:text-primary" href={`/events/${registration.event.slug}`}>{registration.event.title}</Link></h2>
                    <p className="mt-1 text-sm text-muted-foreground">{formatDateTime(registration.event.startAt)} · {registration.event.mode === 'ONLINE' ? 'Online' : registration.event.venue ?? 'Venue to be confirmed'} · {formatCurrency(registration.event.fee)}</p>
                    {registration.status === 'WAITLISTED' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Waitlist position {registration.waitlistPosition ?? '—'}</p>}
                    {registration.attendance && !registration.attendance.revokedAt && <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">Attended · checked in {formatDateTime(registration.attendance.markedAt)}</p>}
                    {registration.certificate && <Link className="mt-2 inline-flex text-xs font-medium text-primary hover:underline" href={`/verify/${registration.certificate.certificateId}`}>Verify certificate {registration.certificate.certificateId}</Link>}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {registration.status === 'CONFIRMED' && <Button size="sm" asChild><Link href={`/dashboard/events/pass/${registration.id}`}><QrCode className="size-4" /> Event pass</Link></Button>}
                    {registration.status === 'WAITLISTED' && <Button size="sm" variant="outline" asChild><Link href={`/events/${registration.event.slug}`}><Ticket className="size-4" /> Event details</Link></Button>}
                    {canCancel && <Button size="sm" variant="ghost" loading={cancelling === registration.id} onClick={() => void cancelRegistration(registration)}><XCircle className="size-4" /> Cancel</Button>}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
