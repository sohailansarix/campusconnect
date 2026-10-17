'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarDays, Download, MapPin, ShieldCheck, Ticket, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/empty-state';
import { get } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { formatDateTime } from '@/lib/utils';

type Pass = {
  registrationId: string;
  passCode: string;
  qrDataUrl: string;
  qrContent: string;
  status: string;
  scannable: boolean;
  event: { id: string; slug: string; title: string; category: string; mode: string; startAt: string; endAt: string; venue: string | null; meetingUrl: string | null; clubName: string | null };
  student: { fullName: string; rollNumber: string | null };
  college: { name: string; logoUrl: string | null };
};

export default function EventPassPage() {
  const { registrationId } = useParams<{ registrationId: string }>();
  const pass = useAsync(() => get<Pass>(`/events/passes/${registrationId}`), { deps: [registrationId] });
  const data = pass.data;

  if (pass.loading) return <div className="mx-auto max-w-3xl px-4 py-10" aria-busy="true"><div className="shimmer h-[32rem] rounded-2xl bg-muted" /></div>;
  if (pass.error) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorState title="Your event pass could not be loaded" description={pass.error} requestId={pass.requestId} onRetry={() => void pass.refetch()} /></div>;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/dashboard/events" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> My events</Link>
      <Card className="mt-6 overflow-hidden p-0" variant="elevated">
        <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-6 py-6 text-white sm:px-8">
          <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold"><Ticket className="size-4" /> CampusConnect event pass</span><StatusBadge status={data.status} /></div>
          <p className="mt-5 text-xs uppercase tracking-[0.16em] text-white/70">{data.college.name}{data.event.clubName ? ` · ${data.event.clubName}` : ''}</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{data.event.title}</h1>
        </div>

        <div className="grid gap-7 p-6 sm:grid-cols-[minmax(0,1fr)_250px] sm:p-8">
          <div>
            <Badge variant="outline">{data.event.category.replaceAll('_', ' ')}</Badge>
            <h2 className="mt-5 text-lg font-semibold">{data.student.fullName}</h2>
            {data.student.rollNumber && <p className="mt-1 text-sm text-muted-foreground">Roll number {data.student.rollNumber}</p>}
            <dl className="mt-6 space-y-4 text-sm">
              <PassDetail icon={<CalendarDays />} label="Date and time" value={`${formatDateTime(data.event.startAt)} – ${formatDateTime(data.event.endAt)}`} />
              <PassDetail icon={data.event.mode === 'ONLINE' ? <Video /> : <MapPin />} label={data.event.mode === 'ONLINE' ? 'Format' : 'Venue'} value={data.event.mode === 'ONLINE' ? 'Online' : data.event.venue ?? 'Venue to be confirmed'} />
            </dl>
            <div className="mt-6 rounded-lg bg-muted/60 p-4">
              <p className="text-xs font-medium text-muted-foreground">Pass code</p>
              <p className="mt-1 font-mono text-xl font-bold tracking-widest">{data.passCode}</p>
              <p className="mt-2 text-xs text-muted-foreground">Keep this code available at the venue. The QR pass works without a network connection once downloaded.</p>
            </div>
            {!data.scannable && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">This registration is {data.status.toLowerCase()} and cannot be scanned as an active pass.</p>}
            {data.event.meetingUrl && <a className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" href={data.event.meetingUrl} target="_blank" rel="noreferrer">Open event meeting link</a>}
          </div>

          <div className="flex flex-col items-center rounded-xl border border-border bg-white p-4 text-center text-slate-900">
            <img src={data.qrDataUrl} alt={`QR event pass for ${data.student.fullName}`} className="aspect-square w-full max-w-[220px]" />
            <p className="mt-2 text-xs text-slate-600">Show this QR code to the event coordinator</p>
            <a href={data.qrDataUrl} download={`campusconnect-pass-${data.passCode}.png`} className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"><Download className="size-4" /> Download QR pass</a>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-6 py-4 text-xs text-muted-foreground sm:px-8"><ShieldCheck className="size-4 text-emerald-600" /> Digitally signed pass · Pass code {data.passCode}</div>
      </Card>
    </div>
  );
}

function PassDetail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-start gap-3"><span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span><div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div></div>;
}
