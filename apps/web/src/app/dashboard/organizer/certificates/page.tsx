'use client';

import * as React from 'react';
import { Award, MailCheck, ShieldCheck } from 'lucide-react';
import { roleHasPermission } from '@campusconnect/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { apiList, post } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';

type CompletedEvent = { id: string; title: string; startAt: string; attendanceCount: number; certificateEnabled: boolean; status: string };
type IssueResult = { issued: number; skipped: number; failed: { studentId: string; reason: string }[]; certificateIds: string[]; message: string };

export default function OrganizerCertificatesPage() {
  const { user } = useSession();
  const canIssue = Boolean(user && roleHasPermission(user.role, 'certificate:issue'));
  const events = useAsync(async () => {
    const result = await apiList<CompletedEvent>('/events', { query: { page: 1, pageSize: 100, status: ['COMPLETED'], upcomingOnly: false } });
    return result.data;
  }, { enabled: canIssue });
  const [eventId, setEventId] = React.useState('');
  const [sending, setSending] = React.useState(true);
  const [issuing, setIssuing] = React.useState(false);
  const [result, setResult] = React.useState<IssueResult | null>(null);

  React.useEffect(() => {
    if (!eventId && events.data?.length) setEventId(events.data[0]!.id);
  }, [eventId, events.data]);

  const issue = async () => {
    if (!eventId) return;
    setIssuing(true);
    setResult(null);
    try {
      const issued = await post<IssueResult>('/certificates/issue/event', { eventId, sendEmail: sending });
      setResult(issued);
      toast.success(issued.message || `${issued.issued} certificates issued`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Certificates could not be issued');
    } finally {
      setIssuing(false);
    }
  };

  if (!canIssue) return <EmptyState icon={<Award />} title="Certificate issuing is restricted" description="An event organiser or college administrator can issue certificates to verified attendees." />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Verified campus achievements</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Issue event certificates</h1><p className="mt-2 text-sm text-muted-foreground">Certificates are issued to attendees with a valid check-in, not everyone who registered.</p></div>
      <Card>
        <div className="flex items-start gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><ShieldCheck className="size-5" /></span><div><h2 className="font-semibold">Bulk issue certificates</h2><p className="mt-1 text-sm text-muted-foreground">Choose a completed event. The system checks attendance records, avoids duplicate certificates, and creates a public verification link for each one.</p></div></div>
        {events.loading ? <div className="shimmer mt-6 h-11 rounded-lg bg-muted" aria-busy="true" /> : events.error ? <ErrorState className="mt-6" compact title="Could not load completed events" description={events.error} onRetry={() => void events.refetch()} /> : events.data?.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div><label htmlFor="certificate-event" className="mb-2 block text-sm font-medium">Completed event</label><Select id="certificate-event" value={eventId} onChange={(value) => { setEventId(value); setResult(null); }} options={events.data.map((event) => ({ value: event.id, label: `${event.title} · ${formatDateTime(event.startAt)}` }))} /></div>
            <label className="flex h-11 items-center gap-2 text-sm"><input type="checkbox" checked={sending} onChange={(event) => setSending(event.target.checked)} className="size-4 rounded border-input accent-primary" /><MailCheck className="size-4 text-muted-foreground" /> Email certificates</label>
            <div className="sm:col-span-2"><Button loading={issuing} onClick={() => void issue()}><Award className="size-4" /> Issue to attendees</Button><p className="mt-2 text-xs text-muted-foreground">Only students marked present are eligible. Duplicate certificates are skipped unless an admin reissues them.</p></div>
          </div>
        ) : <EmptyState className="mt-6" compact icon={<Award />} title="No completed events yet" description="Once an event is complete, it will appear here for certificate issuing." />}
        {result && <div role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"><p className="font-semibold">{result.message}</p><p className="mt-1 text-sm text-muted-foreground">Issued: {result.issued} · Already issued: {result.skipped} · Failed: {result.failed.length}</p>{result.certificateIds.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Verification IDs: {result.certificateIds.join(', ')}</p>}</div>}
      </Card>
    </div>
  );
}
