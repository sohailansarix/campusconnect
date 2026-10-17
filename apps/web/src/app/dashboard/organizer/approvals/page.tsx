'use client';

import * as React from 'react';
import { Check, ClipboardCheck, MessageSquareText, X } from 'lucide-react';
import { roleHasAnyPermission } from '@campusconnect/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { apiList, post } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';

type PendingEvent = { id: string; title: string; summary: string | null; category: string; mode: string; status: string; venue: string | null; startAt: string; endAt: string; registrationCount: number; approvals: { stage: string; decision: string; note: string | null; createdAt: string; actor: { fullName: string; role: string } }[] };

export default function EventApprovalsPage() {
  const { user } = useSession();
  const allowed = Boolean(user && roleHasAnyPermission(user.role, ['event:approve_faculty', 'event:approve_admin']));
  const pending = useAsync(async () => {
    const response = await apiList<PendingEvent>('/events/approvals/pending', { query: { page: 1, pageSize: 50 } });
    return response.data;
  }, { enabled: allowed });
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [actingOn, setActingOn] = React.useState<string | null>(null);

  const decide = async (event: PendingEvent, decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') => {
    const note = notes[event.id]?.trim() ?? '';
    if (decision !== 'APPROVE' && note.length < 10) {
      toast.error('Add at least 10 characters explaining the requested change or rejection.');
      return;
    }
    setActingOn(event.id);
    try {
      const result = await post<{ status: string }>(`/events/${event.id}/decide`, { decision, ...(note ? { note } : {}) });
      toast.success(decision === 'APPROVE' ? (result.status === 'PUBLISHED' ? 'Event approved and published' : 'Event approved for the next review stage') : decision === 'REJECT' ? 'Event rejected' : 'Changes requested');
      await pending.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The approval could not be saved');
    } finally {
      setActingOn(null);
    }
  };

  if (!allowed) return <EmptyState icon={<ClipboardCheck />} title="You do not have event approval access" description="Faculty coordinators and college administrators can review event proposals." />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div><p className="text-sm font-medium text-primary">Event governance</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Approval queue</h1><p className="mt-2 text-sm text-muted-foreground">Review event details before they are published to students.</p></div>
      {pending.loading ? <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((key) => <div key={key} className="shimmer h-48 rounded-xl bg-muted" />)}</div> : pending.error ? <ErrorState title="Could not load approval queue" description={pending.error} requestId={pending.requestId} onRetry={() => void pending.refetch()} /> : pending.data?.length ? <div className="space-y-4">{pending.data.map((event) => <Card key={event.id}>
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-xs text-muted-foreground">{event.category.replaceAll('_', ' ')} · {event.mode === 'ONLINE' ? 'Online' : event.venue ?? 'Venue TBD'}</span></div>
        <h2 className="mt-3 text-lg font-semibold">{event.title}</h2>
        {event.summary && <p className="mt-2 text-sm text-muted-foreground">{event.summary}</p>}
        <p className="mt-3 text-xs text-muted-foreground">{formatDateTime(event.startAt)} – {formatDateTime(event.endAt)} · {event.registrationCount} registered</p>
        {event.approvals.length > 0 && <div className="mt-4 space-y-2 border-l-2 border-border pl-3">{event.approvals.map((approval, index) => <p key={`${approval.stage}-${index}`} className="text-xs text-muted-foreground">{approval.actor.fullName} · {approval.stage.toLowerCase()} · {formatDateTime(approval.createdAt)}{approval.note ? ` · ${approval.note}` : ''}</p>)}</div>}
        <div className="mt-5"><label htmlFor={`approval-note-${event.id}`} className="mb-2 block text-xs font-medium">Review note <span className="font-normal text-muted-foreground">(required for changes or rejection)</span></label><Input id={`approval-note-${event.id}`} value={notes[event.id] ?? ''} onChange={(e) => setNotes((current) => ({ ...current, [event.id]: e.target.value }))} maxLength={1000} placeholder="Explain what should change" /></div>
        <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" loading={actingOn === event.id} onClick={() => void decide(event, 'APPROVE')}><Check className="size-4" /> Approve</Button><Button size="sm" variant="outline" disabled={actingOn === event.id} onClick={() => void decide(event, 'REQUEST_CHANGES')}><MessageSquareText className="size-4" /> Request changes</Button><Button size="sm" variant="ghost" disabled={actingOn === event.id} onClick={() => void decide(event, 'REJECT')}><X className="size-4" /> Reject</Button></div>
      </Card>)}</div> : <EmptyState icon={<ClipboardCheck />} title="The queue is clear" description="New event submissions will appear here for review." />}
    </div>
  );
}
