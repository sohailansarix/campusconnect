'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, MapPin, ShieldCheck, Users, Video } from 'lucide-react';
import { roleHasPermission, type EventCategory } from '@campusconnect/shared';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { get, post } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { useSession } from '@/lib/session';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type EventDetail = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string;
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
  waitlistEnabled: boolean;
  certificateEnabled: boolean;
  club: { name: string } | null;
  college: { name: string };
  viewerRegistration: { id: string; status: string } | null;
  stats: { seatsRemaining: number | null; registrationOpen: boolean; attendanceCount: number; waitlistCount: number };
};

type RegistrationResult = { registrationId: string; status: string; message: string; waitlistPosition: number | null };

export default function EventDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const detail = useAsync(() => get<EventDetail>(`/events/${encodeURIComponent(slug)}`), { deps: [slug] });
  const [registering, setRegistering] = React.useState(false);
  const [registrationError, setRegistrationError] = React.useState<string | null>(null);

  const event = detail.data;
  const canRegister = Boolean(user && roleHasPermission(user.role, 'event:register'));
  const submitRegistration = async () => {
    if (!event || !canRegister) return;
    setRegistering(true);
    setRegistrationError(null);
    try {
      const result = await post<RegistrationResult>(`/events/${event.id}/register`, { acceptWaitlist: true });
      router.push(`/dashboard/events/pass/${result.registrationId}`);
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : 'Registration could not be completed.');
    } finally {
      setRegistering(false);
    }
  };

  if (detail.loading) {
    return <div className="container py-12" aria-busy="true"><div className="shimmer h-72 rounded-2xl bg-muted" /><div className="shimmer mt-6 h-8 w-1/2 rounded bg-muted" /></div>;
  }
  if (detail.error) {
    return <div className="container py-12"><ErrorState title="Could not load this event" description={detail.error} requestId={detail.requestId} onRetry={() => void detail.refetch()} /></div>;
  }
  if (!event) {
    return <div className="container py-12"><EmptyState icon={<CalendarDays />} title="Event not found" action={<Button asChild><Link href="/events">Browse events</Link></Button>} /></div>;
  }

  const alreadyRegistered = Boolean(event.viewerRegistration && event.viewerRegistration.status !== 'CANCELLED');
  const full = event.stats.seatsRemaining === 0;

  return (
    <div className="container max-w-6xl py-8 lg:py-12">
      <Link href="/events" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to events
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main>
          <div className="relative flex min-h-56 items-end overflow-hidden rounded-2xl bg-gradient-to-br from-blue-100 via-sky-50 to-indigo-100 p-6 dark:from-blue-950 dark:via-slate-900 dark:to-indigo-950 sm:min-h-80 sm:p-9">
            {event.bannerUrl && <img src={event.bannerUrl} alt="" className="absolute inset-0 size-full object-cover" />}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
            <div className="relative z-10 max-w-3xl text-white">
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge className="border-white/20 bg-white/15 text-white">{event.category.replaceAll('_', ' ')}</Badge>
                <StatusBadge status={event.status} />
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{event.title}</h1>
              {event.summary && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">{event.summary}</p>}
            </div>
          </div>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">About this event</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">{event.description}</p>
            <div className="mt-7 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{event.college.name}</Badge>
              {event.club && <Badge variant="outline">Hosted by {event.club.name}</Badge>}
              {event.certificateEnabled && <Badge variant="verified"><ShieldCheck className="size-3" /> Certificate included</Badge>}
            </div>
          </section>
        </main>

        <aside>
          <Card className="sticky top-24">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Event details</p>
                <p className="mt-2 text-xl font-semibold">{formatCurrency(event.fee, event.currency)}</p>
              </div>
              {alreadyRegistered && <StatusBadge status={event.viewerRegistration!.status} />}
            </div>

            <dl className="mt-6 space-y-4 text-sm">
              <Detail icon={<CalendarDays />} label="Date" value={formatDateTime(event.startAt)} />
              <Detail icon={<Clock3 />} label="Ends" value={formatDateTime(event.endAt)} />
              <Detail icon={event.mode === 'ONLINE' ? <Video /> : <MapPin />} label={event.mode === 'ONLINE' ? 'Format' : 'Venue'} value={event.mode === 'ONLINE' ? 'Online' : event.venue ?? 'Venue to be confirmed'} />
              {event.capacity > 0 && <Detail icon={<Users />} label="Availability" value={full ? (event.waitlistEnabled ? 'Full · waitlist open' : 'Full') : `${event.stats.seatsRemaining} seats remaining`} />}
            </dl>

            {registrationError && <p role="alert" className="mt-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{registrationError}</p>}

            <div className="mt-6">
              {alreadyRegistered ? (
                <Button className="w-full" asChild><Link href={`/dashboard/events/pass/${event.viewerRegistration!.id}`}>View your event pass</Link></Button>
              ) : canRegister && event.stats.registrationOpen ? (
                <Button className="w-full" loading={registering} onClick={() => void submitRegistration()}>
                  {full ? 'Join the waitlist' : 'Register for this event'}
                </Button>
              ) : !user && !sessionLoading ? (
                <Button className="w-full" asChild><Link href={`/login?next=${encodeURIComponent(`/events/${event.slug}`)}`}>Sign in to register</Link></Button>
              ) : (
                <Button className="w-full" disabled>{event.status !== 'PUBLISHED' ? 'Registration unavailable' : 'Registration closed'}</Button>
              )}
              {alreadyRegistered && <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3.5" /> Your registration is saved to My Events</p>}
              {event.registrationDeadline && <p className="mt-4 text-center text-xs text-muted-foreground">Registration closes {formatDateTime(event.registrationDeadline)}</p>}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-start gap-3"><span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span><div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div></div>;
}
