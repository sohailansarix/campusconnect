'use client';

import * as React from 'react';
import { Camera, CameraOff, CheckCircle2, CircleAlert, ScanLine, Users } from 'lucide-react';
import { roleHasPermission } from '@campusconnect/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { apiList, get, post } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';

type EventChoice = { id: string; title: string; status: string; startAt: string; attendanceCount: number; registrationCount: number };
type Attendee = { id: string; status: string; student: { id: string; fullName: string; email: string; department: { name: string; code: string } | null; studentProfile: { rollNumber: string | null } | null }; attendance: { id: string; markedAt: string; revokedAt: string | null } | null };
type ScanResult = { outcome: 'ADMITTED' | 'ALREADY_MARKED' | 'WALK_IN_ADMITTED' | 'REJECTED'; message: string; student: { fullName: string; rollNumber: string | null; departmentCode: string | null } | null; counters: { admitted: number; expected: number; waitlisted: number } };
type LiveFeed = { counters: { admitted: number; expected: number; waitlisted: number }; attendanceRate: number; recent: { id: string; markedAt: string; method: string; student: { fullName: string } }[] };
type Scanner = import('html5-qrcode').Html5Qrcode;

export default function AttendanceScannerPage() {
  const { user } = useSession();
  const canScan = Boolean(user && roleHasPermission(user.role, 'event:manage_attendance'));
  const [eventId, setEventId] = React.useState('');
  const [cameraRunning, setCameraRunning] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [manualReason, setManualReason] = React.useState('');
  const [checkingIn, setCheckingIn] = React.useState<string | null>(null);
  const scannerRef = React.useRef<Scanner | null>(null);
  const processingRef = React.useRef(false);

  const events = useAsync(async () => {
    const response = await apiList<EventChoice>('/events', {
      query: { page: 1, pageSize: 100, organizerId: user?.id, status: ['PUBLISHED', 'ONGOING'], upcomingOnly: false },
    });
    return response.data;
  }, { enabled: canScan, deps: [user?.id] });

  React.useEffect(() => {
    if (!eventId && events.data?.length) {
      const requested = new URLSearchParams(window.location.search).get('eventId');
      setEventId(events.data.find((event) => event.id === requested)?.id ?? events.data[0]!.id);
    }
  }, [eventId, events.data]);

  const roster = useAsync(async () => {
    const response = await apiList<Attendee>(`/events/${eventId}/registrations`, {
      query: { page: 1, pageSize: 100, status: ['CONFIRMED', 'ATTENDED'] },
    });
    return response.data;
  }, { enabled: canScan && Boolean(eventId), deps: [eventId] });

  const live = useAsync(() => get<LiveFeed>(`/attendance/live?eventId=${encodeURIComponent(eventId)}`), {
    enabled: canScan && Boolean(eventId),
    deps: [eventId],
    refreshOnFocus: true,
  });

  React.useEffect(() => {
    if (!eventId || !canScan) return;
    const timer = window.setInterval(() => void live.refetch(), 10_000);
    return () => window.clearInterval(timer);
  }, [eventId, canScan, live.refetch]);

  const stopCamera = React.useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    scannerRef.current = null;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      // The scanner can already be stopped if permission was revoked or the page
      // was backgrounded; clearing the local state is still the useful outcome.
    }
    setCameraRunning(false);
  }, []);

  React.useEffect(() => () => {
    const scanner = scannerRef.current;
    if (scanner) {
      void scanner.stop().catch(() => undefined);
      scannerRef.current = null;
    }
  }, []);

  const handleScan = React.useCallback(async (token: string) => {
    if (!eventId || processingRef.current) return;
    processingRef.current = true;
    setScanError(null);
    try {
      const result = await post<ScanResult>('/attendance/scan', {
        token,
        eventId,
        method: 'QR_SCAN',
        deviceLabel: 'CampusConnect web scanner',
      });
      setScanResult(result);
      void Promise.all([roster.refetch(), live.refetch()]);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'The pass could not be scanned');
    } finally {
      window.setTimeout(() => { processingRef.current = false; }, 1200);
    }
  }, [eventId, roster.refetch, live.refetch]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('campusconnect-qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
        (decodedText) => void handleScan(decodedText),
        () => undefined,
      );
      setCameraRunning(true);
    } catch (error) {
      scannerRef.current = null;
      setCameraError(error instanceof Error ? error.message : 'Camera access is unavailable. Use the manual check-in list below.');
      setCameraRunning(false);
    }
  };

  const manualCheckIn = async (attendee: Attendee) => {
    setCheckingIn(attendee.id);
    setScanError(null);
    try {
      const result = await post<ScanResult>('/attendance/manual', {
        eventId,
        studentId: attendee.student.id,
        reason: manualReason,
      });
      setScanResult(result);
      await Promise.all([roster.refetch(), live.refetch()]);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Manual check-in failed');
    } finally {
      setCheckingIn(null);
    }
  };

  if (!canScan) return <EmptyState icon={<ScanLine />} title="Attendance scanning is for event coordinators" description="Sign in with a club lead, faculty coordinator or college admin account to scan event passes." />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div><p className="text-sm font-medium text-primary">Event operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Attendance scanner</h1><p className="mt-2 text-sm text-muted-foreground">Scan a signed event pass or use the audited manual check-in fallback.</p></div>

      <Card>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="scan-event">Select an event</label>
            <Select id="scan-event" value={eventId} onChange={(value) => { void stopCamera(); setEventId(value); setScanResult(null); }} placeholder="Choose an event" options={(events.data ?? []).map((event) => ({ value: event.id, label: event.title }))} disabled={events.loading || !events.data?.length} />
            {events.loading && <p className="mt-2 text-xs text-muted-foreground">Loading your active events…</p>}
            {events.error && <p role="alert" className="mt-2 text-sm text-destructive">{events.error}</p>}
            {!events.loading && !events.error && !events.data?.length && <p className="mt-2 text-sm text-muted-foreground">No published or ongoing events are assigned to your account.</p>}
            {eventId && <p className="mt-2 text-xs text-muted-foreground">{events.data?.find((event) => event.id === eventId)?.startAt ? formatDateTime(events.data.find((event) => event.id === eventId)!.startAt) : ''}</p>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Counter label="Admitted" value={live.data?.counters.admitted} />
            <Counter label="Expected" value={live.data?.counters.expected} />
            <Counter label="Waitlist" value={live.data?.counters.waitlisted} />
          </div>
        </div>
      </Card>

      {eventId && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Scan a pass</h2><p className="mt-1 text-xs text-muted-foreground">Allow camera access and hold the QR code inside the frame.</p></div><Button size="sm" variant={cameraRunning ? 'outline' : 'default'} onClick={() => cameraRunning ? void stopCamera() : void startCamera()}>{cameraRunning ? <><CameraOff /> Stop camera</> : <><Camera /> Start camera</>}</Button></div>
          <div id="campusconnect-qr-reader" className="mt-4 min-h-64 overflow-hidden rounded-xl border border-border bg-slate-950 [&_video]:mx-auto [&_video]:max-h-[360px] [&_video]:object-cover" aria-label="QR pass camera scanner" />
          {cameraError && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{cameraError}</p>}
          {scanError && <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{scanError}</p>}
          {scanResult && <div role="status" className={`mt-4 rounded-xl border p-4 ${scanResult.outcome === 'REJECTED' ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30' : 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'}`}><div className="flex items-start gap-3">{scanResult.outcome === 'REJECTED' ? <CircleAlert className="mt-0.5 size-5 text-amber-700" /> : <CheckCircle2 className="mt-0.5 size-5 text-emerald-700" />}<div><p className="font-semibold">{scanResult.student?.fullName ?? 'Pass result'}</p><p className="mt-1 text-sm">{scanResult.message}</p>{scanResult.student?.rollNumber && <p className="mt-1 text-xs text-muted-foreground">{scanResult.student.rollNumber}{scanResult.student.departmentCode ? ` · ${scanResult.student.departmentCode}` : ''}</p>}</div></div></div>}
          <p className="mt-3 text-xs text-muted-foreground">Camera permissions require HTTPS in production. If scanning does not work, search for the student in the manual check-in roster.</p>
        </Card>

        <Card>
          <div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Users className="size-4" /></span><div><h2 className="font-semibold">Manual check-in</h2><p className="mt-1 text-xs text-muted-foreground">Use when a student's phone is unavailable. A reason is saved in the audit trail.</p></div></div>
          <label htmlFor="manual-reason" className="mb-2 mt-5 block text-xs font-medium">Reason for bypassing the QR scan</label>
          <Input id="manual-reason" value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="For example, phone battery depleted" maxLength={300} />
          <div className="mt-4 max-h-[360px] space-y-2 overflow-auto pr-1">
            {roster.loading ? <p className="text-sm text-muted-foreground">Loading registered attendees…</p> : roster.error ? <ErrorState compact title="Roster unavailable" description={roster.error} onRetry={() => void roster.refetch()} /> : roster.data?.filter((row) => row.status !== 'ATTENDED' && !row.attendance).length ? roster.data.filter((row) => row.status !== 'ATTENDED' && !row.attendance).map((attendee) => (
              <div key={attendee.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{attendee.student.fullName}</p><p className="truncate text-xs text-muted-foreground">{attendee.student.studentProfile?.rollNumber ?? attendee.student.email}{attendee.student.department ? ` · ${attendee.student.department.code}` : ''}</p></div><Button size="sm" variant="outline" loading={checkingIn === attendee.id} disabled={manualReason.trim().length < 5} onClick={() => void manualCheckIn(attendee)}>Check in</Button></div>
            )) : <EmptyState compact icon={<CheckCircle2 />} title="Everyone is checked in" description="No registered attendees are waiting for a check-in." />}
          </div>
        </Card>
      </div>}
    </div>
  );
}

function Counter({ label, value }: { label: string; value?: number }) {
  return <div className="rounded-lg bg-muted/60 px-3 py-3 text-center"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value ?? '—'}</p></div>;
}
