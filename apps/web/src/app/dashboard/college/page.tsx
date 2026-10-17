'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Award, BarChart3, CalendarDays, Download, GraduationCap, Users } from 'lucide-react';
import { roleHasPermission } from '@campusconnect/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState, ErrorState, StatsSkeleton } from '@/components/ui/empty-state';
import { get, downloadFile } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { useSession } from '@/lib/session';
import { formatCompact, formatPercent } from '@/lib/utils';

type Overview = {
  students: { total: number; active: number; byYear: { year: number; count: number }[]; byDepartment: { departmentId: string | null; name: string; code: string; count: number }[] };
  events: { total: number; published: number; completed: number; upcoming: number; registrations: number; attendance: number; attendanceRate: number };
  certificates: { issued: number; revoked: number; thisMonth: number };
  clubs: { total: number; members: number; active: number };
  readiness: { average: number; distribution: { band: string; count: number }[] };
  engagement: { participationRate: number; activeStudents: number; dormantStudents: number };
};
type EventEngagement = { popularCategories: { category: string; count: number; registrations: number; attendance: number; attendanceRate: number }[] };

export default function CollegeDashboardPage() {
  const { user } = useSession();
  const router = useRouter();
  const allowed = Boolean(user && roleHasPermission(user.role, 'analytics:read_college'));
  const overview = useAsync(() => get<Overview>('/analytics/overview'), { enabled: allowed });
  const events = useAsync(() => get<EventEngagement>('/analytics/events?granularity=MONTH'), { enabled: allowed });
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    if (!allowed && user) router.replace('/dashboard');
  }, [allowed, user, router]);

  const exportCategories = async () => {
    setExporting(true);
    try {
      await downloadFile('/analytics/export?report=EVENT_ENGAGEMENT&granularity=MONTH', 'event-engagement.csv');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The report could not be downloaded');
    } finally {
      setExporting(false);
    }
  };

  if (!allowed) return <EmptyState icon={<BarChart3 />} title="College analytics" description="This dashboard is available to college administrators and placement officers." />;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-primary">Institution overview</p><h1 className="mt-1 text-2xl font-bold tracking-tight">College analytics</h1><p className="mt-2 text-sm text-muted-foreground">Engagement and career readiness from verified activity at your institution.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" loading={exporting} onClick={() => void exportCategories()}><Download className="size-4" /> Export event report</Button><Button variant="outline" asChild><Link href="/dashboard/organizer/events">Manage events</Link></Button></div></div>

      {overview.loading ? <StatsSkeleton count={4} /> : overview.error ? <ErrorState title="Could not load college analytics" description={overview.error} requestId={overview.requestId} onRetry={() => void overview.refetch()} /> : overview.data && <>
        <StatGrid>
          <StatCard label="Students" value={formatCompact(overview.data.students.total)} hint={`${formatCompact(overview.data.students.active)} active accounts`} icon={<Users />} tone="default" />
          <StatCard label="Upcoming events" value={overview.data.events.upcoming} hint={`${overview.data.events.published} published`} icon={<CalendarDays />} tone="purple" />
          <StatCard label="Attendance rate" value={formatPercent(overview.data.events.attendanceRate)} hint={`${formatCompact(overview.data.events.attendance)} check-ins`} icon={<BarChart3 />} tone="teal" />
          <StatCard label="Certificates issued" value={formatCompact(overview.data.certificates.issued)} hint={`${overview.data.certificates.thisMonth} this month`} icon={<Award />} tone="success" />
        </StatGrid>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader><CardTitle>Student readiness</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-5 flex items-end gap-2"><span className="text-4xl font-bold tabular-nums">{Math.round(overview.data.readiness.average)}</span><span className="pb-1 text-sm text-muted-foreground">average readiness score / 100</span></div>
              <div className="h-64 w-full" role="img" aria-label="Students grouped by career readiness score">
                <ResponsiveContainer width="100%" height="100%"><BarChart data={overview.data.readiness.distribution} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="band" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ borderRadius: 12, borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }} /><Bar dataKey="count" name="Students" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity by department</CardTitle></CardHeader>
            <CardContent>
              {overview.data.students.byDepartment.length ? <div className="space-y-4">{overview.data.students.byDepartment.map((department) => {
                const share = overview.data!.students.total ? Math.round((department.count / overview.data!.students.total) * 100) : 0;
                return <div key={department.departmentId ?? department.code}><div className="flex justify-between gap-3 text-sm"><span className="truncate font-medium">{department.name}</span><span className="shrink-0 text-muted-foreground">{department.count} students</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} /></div></div>;
              })}</div> : <p className="text-sm text-muted-foreground">Department data will appear as student profiles are completed.</p>}
              <div className="mt-6 grid grid-cols-2 gap-3"><MiniKpi label="Active participants" value={overview.data.engagement.activeStudents} icon={<GraduationCap />} /><MiniKpi label="Clubs active" value={overview.data.clubs.active} icon={<Users />} /></div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>Popular event categories</CardTitle><span className="text-xs text-muted-foreground">Last 90 days</span></CardHeader>
          <CardContent>
            {events.loading ? <div className="shimmer h-48 rounded-lg bg-muted" aria-busy="true" /> : events.error ? <ErrorState compact title="Category data unavailable" description={events.error} onRetry={() => void events.refetch()} /> : events.data?.popularCategories.length ? <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={events.data.popularCategories.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 16 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="category" width={115} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ borderRadius: 12, borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }} /><Bar dataKey="registrations" name="Registrations" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div> : <p className="py-12 text-center text-sm text-muted-foreground">No event activity in this period yet.</p>}
          </CardContent>
        </Card>
      </>}
    </div>
  );
}

function MiniKpi({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="rounded-lg border border-border p-3"><div className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4">{icon}<span className="text-xs">{label}</span></div><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></div>;
}
