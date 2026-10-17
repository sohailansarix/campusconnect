'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarPlus } from 'lucide-react';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS, eventSchemas, type EventCategory } from '@campusconnect/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { post } from '@/lib/api';
import { useSession } from '@/lib/session';

const defaultDates = () => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const localInput = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  return { startAt: localInput(start), endAt: localInput(end) };
};

export default function CreateEventPage() {
  const router = useRouter();
  const { user } = useSession();
  const dates = React.useMemo(defaultDates, []);
  const [form, setForm] = React.useState({ title: '', summary: '', description: '', category: 'WORKSHOP' as EventCategory, mode: 'OFFLINE', venue: '', meetingUrl: '', startAt: dates.startAt, endAt: dates.endAt, registrationDeadline: '', capacity: '100', feeRupees: '0' });
  const [submitForApproval, setSubmitForApproval] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  const setField = (field: keyof typeof form, value: string) => setForm((previous) => ({ ...previous, [field]: value }));

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    const parsed = eventSchemas.createEventSchema.safeParse({
      title: form.title,
      summary: form.summary || undefined,
      description: form.description,
      category: form.category,
      mode: form.mode,
      venue: form.venue || undefined,
      meetingUrl: form.meetingUrl || undefined,
      startAt: new Date(form.startAt),
      endAt: new Date(form.endAt),
      ...(form.registrationDeadline ? { registrationDeadline: new Date(form.registrationDeadline) } : {}),
      capacity: Number(form.capacity || 0),
      fee: Math.round(Number(form.feeRupees || 0) * 100),
      currency: 'INR',
      waitlistEnabled: true,
      certificateEnabled: true,
      eligibleYears: [],
      tags: [],
    });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Check the event details and try again.');
      return;
    }

    setSaving(true);
    try {
      const created = await post<{ id: string; title: string }>('/events', parsed.data);
      if (submitForApproval) {
        try {
          await post(`/events/${created.id}/submit`, {});
          toast.success('Event submitted for approval');
        } catch (submissionError) {
          toast.error(`Draft saved, but it could not be submitted: ${submissionError instanceof Error ? submissionError.message : 'please try again'}`);
        }
      } else {
        toast.success('Event draft saved');
      }
      router.push('/dashboard/organizer/events');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard/organizer/events" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Managed events</Link>
      <div><p className="text-sm font-medium text-primary">Event operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Create an event</h1><p className="mt-2 text-sm text-muted-foreground">Events start as drafts. Submit one for review to publish it to student discovery.</p></div>
      <Card>
        <form onSubmit={save} className="space-y-6" noValidate>
          {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {fieldError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{fieldError}</p>}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Event title" htmlFor="event-title" required><Input id="event-title" value={form.title} onChange={(e) => setField('title', e.target.value)} required minLength={5} maxLength={160} placeholder="Advanced Excel for Business Analytics" /></Field></div>
            <Field label="Category" htmlFor="event-category"><Select id="event-category" value={form.category} onChange={(value) => setField('category', value)} options={EVENT_CATEGORIES.map((category) => ({ value: category, label: EVENT_CATEGORY_LABELS[category] }))} /></Field>
            <Field label="Format" htmlFor="event-mode"><Select id="event-mode" value={form.mode} onChange={(value) => setField('mode', value)} options={[{ value: 'OFFLINE', label: 'In person' }, { value: 'ONLINE', label: 'Online' }, { value: 'HYBRID', label: 'Hybrid' }]} /></Field>
            {form.mode !== 'ONLINE' && <Field label="Venue" htmlFor="event-venue" required><Input id="event-venue" value={form.venue} onChange={(e) => setField('venue', e.target.value)} placeholder="Main auditorium" /></Field>}
            {form.mode !== 'OFFLINE' && <Field label="Meeting link" htmlFor="event-meeting" required><Input id="event-meeting" type="url" value={form.meetingUrl} onChange={(e) => setField('meetingUrl', e.target.value)} placeholder="https://meet.example.com/..." /></Field>}
            <Field label="Starts" htmlFor="event-start" required><Input id="event-start" type="datetime-local" value={form.startAt} onChange={(e) => setField('startAt', e.target.value)} required /></Field>
            <Field label="Ends" htmlFor="event-end" required><Input id="event-end" type="datetime-local" value={form.endAt} onChange={(e) => setField('endAt', e.target.value)} required /></Field>
            <Field label="Registration deadline" htmlFor="event-deadline" hint="Optional. Registration closes two hours before the start time by default."><Input id="event-deadline" type="datetime-local" value={form.registrationDeadline} onChange={(e) => setField('registrationDeadline', e.target.value)} /></Field>
            <Field label="Capacity" htmlFor="event-capacity" hint="Use 0 for unlimited capacity."><Input id="event-capacity" type="number" min="0" max="100000" value={form.capacity} onChange={(e) => setField('capacity', e.target.value)} /></Field>
            <Field label="Ticket price (₹)" htmlFor="event-fee" hint="Phase 1 records the fee; online payments are not enabled."><Input id="event-fee" type="number" min="0" step="0.01" value={form.feeRupees} onChange={(e) => setField('feeRupees', e.target.value)} /></Field>
            <Field label="Short summary" htmlFor="event-summary" hint="Up to 280 characters."><Input id="event-summary" value={form.summary} onChange={(e) => setField('summary', e.target.value)} maxLength={280} /></Field>
            <div className="sm:col-span-2"><Field label="Description" htmlFor="event-description" hint="At least 30 characters. Include what participants will learn or do." required><Textarea id="event-description" value={form.description} onChange={(e) => setField('description', e.target.value)} minLength={30} maxLength={8000} rows={7} required /></Field></div>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-border p-4"><input type="checkbox" checked={submitForApproval} onChange={(e) => setSubmitForApproval(e.target.checked)} className="mt-0.5 size-4 accent-primary" /><span><span className="block text-sm font-medium">Submit for approval after saving</span><span className="mt-1 block text-xs text-muted-foreground">A faculty coordinator or college admin must approve it before students can register.</span></span></label>
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => window.history.back()}>Cancel</Button><Button type="submit" loading={saving}><CalendarPlus className="size-4" /> {submitForApproval ? 'Create and submit' : 'Save draft'}</Button></div>
        </form>
      </Card>
    </div>
  );
}
