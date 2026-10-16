'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight, Award, BadgeCheck, Bell, CalendarDays, CheckCircle2, Clock, FileText,
  GraduationCap, Target, TrendingUp, Users,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { get } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAsync } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { ProgressRow, SegmentedProgress } from '@/components/ui/progress';
import { EmptyState, ErrorState, CardListSkeleton, StatsSkeleton } from '@/components/ui/empty-state';
import { JourneyStepper, NextStepCard } from '@/components/journey/journey-stepper';
import { cn, formatCompact, formatEventDate, formatRelative, readinessClasses } from '@/lib/utils';

/**
 * Student dashboard.
 *
 * The page answers one question — "what should I do next?" — in the first screen.
 * Everything below it is supporting evidence.
 *
 * Layout order is deliberate: next-step card, then journey, then the numbers. A
 * student opening this between lectures needs the action, not a chart.
 */

type PassportResponse = {
  readiness: {
    score: number;
    band: string;
    breakdown: { skills: number; projects: number; internship: number; interview: number };
    suggestions: string[];
    calculatedAt: string;
  };
  stats: {
    eventsAttended: number;
    certificatesEarned: number;
    projectsCompleted: number;
    internshipsCompleted: number;
  };
  skills: { id: string; name: string; score: number; verified: boolean }[];
};

type TrendResponse = {
  current: number;
  change: number;
  direction: 'up' | 'down' | 'flat';
  band: string;
  points: { date: string; score: number; skills: number; projects: number; internship: number; interview: number }[];
};

type Registration = {
  id: string;
  status: string;
  passCode: string;
  waitlistPosition: number | null;
  event: {
    id: string;
    slug: string;
    title: string;
    category: string;
    mode: string;
    venue: string | null;
    startAt: string;
    bannerUrl: string | null;
    club: { name: string } | null;
  };
};

type Application = {
  id: string;
  status: string;
  appliedAt: string;
  job: { id: string; title: string; employer: { companyName: string } | null } | null;
};

export default function StudentDashboardPage() {
  const { user } = useSession();

  const passport = useAsync<PassportResponse>(() => get<PassportResponse>('/passport/mine'), {
    deps: [],
    refreshOnFocus: true,
  });

  const trend = useAsync<TrendResponse>(() => get<TrendResponse>('/passport/mine/trend?days=90'));

  const upcoming = useAsync<Registration[]>(async () => {
    const result = await get<{ items: Registration[] }>('/events/mine/registrations?upcomingOnly=true&pageSize=4');
    return (result as unknown as { items: Registration[] }).items ?? [];
  });

  const applications = useAsync<Application[]>(async () => {
    const result = await get<{ items: Application[] }>('/applications/mine?pageSize=4');
    return (result as unknown as { items: Application[] }).items ?? [];
  });

  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      {/* --- Header ------------------------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            {upcoming.data && upcoming.data.length > 0
              ? ` · ${upcoming.data.length} upcoming ${upcoming.data.length === 1 ? 'event' : 'events'}`
              : ''}
          </p>
        </div>

        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/passport/rahul-sharma">
              <BadgeCheck className="size-4" aria-hidden="true" />
              View my passport
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/events">
              <CalendarDays className="size-4" aria-hidden="true" />
              Browse events
            </Link>
          </Button>
        </div>
      </div>

      {/* --- Next step ---------------------------------------------------- */}
      <NextStepSection passport={passport.data} loading={passport.loading} />

      {/* --- Journey ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Your journey</CardTitle>
        </CardHeader>
        <CardContent className="mt-4">
          <JourneyStepper
            completed={deriveCompletedStages(passport.data)}
            current={deriveCurrentStage(passport.data)}
          />
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Stages complete as your evidence accumulates — you do not mark them yourself. Attending an
            event completes <span className="font-medium text-foreground">Participate</span>; a mentor-approved
            project completes <span className="font-medium text-foreground">Build</span>.
          </p>
        </CardContent>
      </Card>

      {/* --- Stats -------------------------------------------------------- */}
      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Your stats
        </h2>

        {passport.loading ? (
          <StatsSkeleton />
        ) : passport.error ? (
          <ErrorState
            compact
            title="Could not load your stats"
            description={passport.error}
            requestId={passport.requestId}
            onRetry={() => void passport.refetch()}
          />
        ) : passport.data ? (
          <StatGrid>
            <StatCard
              label="Events attended"
              value={passport.data.stats.eventsAttended}
              hint="Confirmed attendance"
              icon={<CalendarDays />}
              tone="default"
              href="/dashboard/events"
            />
            <StatCard
              label="Certificates"
              value={passport.data.stats.certificatesEarned}
              hint="All publicly verifiable"
              icon={<Award />}
              tone="success"
              href="/dashboard/certificates"
            />
            <StatCard
              label="Projects"
              value={passport.data.stats.projectsCompleted}
              hint="Mentor-reviewed"
              icon={<FileText />}
              tone="purple"
              href="/dashboard/projects"
            />
            <StatCard
              label="Internships"
              value={passport.data.stats.internshipsCompleted}
              hint="Completed engagements"
              icon={<Target />}
              tone="teal"
              href="/dashboard/internships"
            />
          </StatGrid>
        ) : null}
      </section>

      {/* --- Readiness + trend -------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <ReadinessCard passport={passport.data} loading={passport.loading} />
        <TrendCard trend={trend.data} loading={trend.loading} error={trend.error} onRetry={trend.refetch} />
      </div>

      {/* --- Upcoming + applications -------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <UpcomingEvents state={upcoming} />
        <ApplicationsPanel state={applications} />
      </div>

      {/* --- Skills -------------------------------------------------------- */}
      <SkillsPanel passport={passport.data} loading={passport.loading} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Next step                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Picks the highest-impact next action from the readiness suggestions and the
 * student's own calendar. The API already orders suggestions by estimated impact,
 * so this takes the first one and links it to the right destination.
 */
function NextStepSection({
  passport,
  loading,
}: {
  passport: PassportResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return <div className="shimmer h-32 rounded-xl border border-border bg-muted" />;
  }

  if (!passport) return null;

  const suggestion = passport.readiness.suggestions[0];

  // A student who has done everything the engine can suggest gets an encouragement
  // rather than an empty space where the most important card should be.
  if (!suggestion) {
    return (
      <NextStepCard
        stepLabel="You are interview ready"
        title="Apply to matched roles"
        description="Your evidence covers every pillar. Put your passport in front of employers."
        reason={`Readiness score ${passport.readiness.score}/100 with strong coverage across all four pillars.`}
        actionLabel="See matched jobs"
        actionHref="/dashboard/applications"
      />
    );
  }

  const action = ACTION_ROUTES[suggestion] ?? {
    label: 'Continue',
    href: '/dashboard/passport',
  };

  return (
    <NextStepCard
      stepLabel="Your next step"
      title={suggestion}
      description={action.description}
      reason={`Suggested because it has the largest effect on your readiness score, currently ${passport.readiness.score}/100.`}
      actionLabel={action.label}
      actionHref={action.href}
    />
  );
}

/**
 * Maps a suggestion's text to a destination.
 *
 * The rule-based engine returns human-readable titles; matching on a keyword is
 * brittle but honest — when the AI driver lands, it should return a structured
 * `actionType` and this map goes away. TODO(AI): consume `suggestion.actionType`.
 */
const ACTION_ROUTES: Record<string, { label: string; href: string; description: string }> = {
  'Take a skill assessment': {
    label: 'Start an assessment',
    href: '/dashboard/skills',
    description: 'Establish a baseline so the platform can measure real progress rather than guesses.',
  },
  'Get your top skills verified': {
    label: 'Verify my skills',
    href: '/dashboard/skills',
    description: 'An assessment-backed skill counts in full toward your readiness score.',
  },
  'Build your first portfolio project for your target role': {
    label: 'Browse project briefs',
    href: '/dashboard/projects',
    description: 'A mentor-reviewed project is the strongest single piece of evidence you can add.',
  },
  'Add another project to your portfolio': {
    label: 'Find a project',
    href: '/dashboard/projects',
    description: 'Three approved projects is where employers stop asking for more evidence.',
  },
  'Apply to an internship': {
    label: 'Browse internships',
    href: '/dashboard/internships',
    description: 'This is the heaviest-weighted pillar, and the one placement officers screen on first.',
  },
  'Book a mock interview': {
    label: 'Book a mock interview',
    href: '/dashboard/interviews',
    description: 'Practise with a mentor, or use self-practice mode with the role question bank.',
  },
  'Attend a workshop or club event': {
    label: 'Find an event',
    href: '/events',
    description: 'Campus participation is the fastest way to start building a track record.',
  },
};

/* -------------------------------------------------------------------------- */
/* Readiness                                                                  */
/* -------------------------------------------------------------------------- */

function ReadinessCard({
  passport,
  loading,
}: {
  passport: PassportResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">Loading readiness…</span>
          <div className="shimmer h-4 w-32 rounded bg-muted" />
          <div className="shimmer h-10 w-24 rounded bg-muted" />
          <div className="shimmer h-3 w-full rounded bg-muted" />
          <div className="shimmer h-16 w-full rounded bg-muted" />
        </div>
      </Card>
    );
  }

  if (!passport) {
    return (
      <Card>
        <EmptyState
          compact
          icon={<TrendingUp />}
          title="No readiness score yet"
          description="Take a skill assessment and attend an event to start building your score."
          action={
            <Button asChild size="sm">
              <Link href="/dashboard/skills">Take an assessment</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const { readiness } = passport;
  const tone = readinessClasses(readiness.score);

  const pillars = [
    { key: 'skills', label: 'Skills', value: readiness.breakdown.skills, weight: '30%', tone: 'teal' as const },
    { key: 'projects', label: 'Projects', value: readiness.breakdown.projects, weight: '25%', tone: 'info' as const },
    { key: 'internship', label: 'Internship', value: readiness.breakdown.internship, weight: '25%', tone: 'purple' as const },
    { key: 'interview', label: 'Interview', value: readiness.breakdown.interview, weight: '20%', tone: 'warning' as const },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle>Career Readiness</CardTitle>
        <Badge variant={readiness.score >= 80 ? 'success' : readiness.score >= 60 ? 'info' : 'warning'}>
          {readiness.band}
        </Badge>
      </CardHeader>

      <CardContent className="mt-4">
        <div className="flex items-end gap-2">
          <span className={cn('text-4xl font-bold tracking-tight tabular-nums', tone.text)}>
            {readiness.score}
          </span>
          <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
        </div>

        {/* Segmented bar: the four pillars read as parts of one whole. */}
        <div className="mt-4">
          <SegmentedProgress
            segments={pillars.map((pillar) => ({
              label: pillar.label,
              value: pillar.value,
              tone: pillar.tone,
            }))}
          />
        </div>

        <div className="mt-5 space-y-3.5">
          {pillars.map((pillar) => (
            <ProgressRow
              key={pillar.key}
              label={pillar.label}
              value={pillar.value}
              valueLabel={`${Math.round(pillar.value)} · ${pillar.weight}`}
              tone={pillar.tone}
              size="sm"
            />
          ))}
        </div>

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          Weighted blend of four evidence pillars. Verified skills, mentor-reviewed projects and
          completed internships carry the most weight.
        </p>

        <Button asChild variant="outline" size="sm" className="mt-4 w-full">
          <Link href="/dashboard/passport">
            See the full breakdown
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                      */
/* -------------------------------------------------------------------------- */

function TrendCard({
  trend,
  loading,
  error,
  onRetry,
}: {
  trend: TrendResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  if (loading) {
    return (
      <Card>
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">Loading your progress…</span>
          <div className="shimmer h-4 w-40 rounded bg-muted" />
          <div className="shimmer h-[240px] w-full rounded bg-muted" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState compact title="Could not load your progress" description={error} onRetry={() => void onRetry()} />
      </Card>
    );
  }

  if (!trend || trend.points.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Readiness over time</CardTitle>
        </CardHeader>
        <CardContent className="mt-4">
          <EmptyState
            compact
            icon={<TrendingUp />}
            title="Not enough history yet"
            description="Your trend appears once you have a few weeks of activity — attendance, assessments and reviews all feed it."
          />
        </CardContent>
      </Card>
    );
  }

  const chartData = trend.points.map((point) => ({
    date: new Date(point.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    score: point.score,
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Readiness over time</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Last 90 days, sampled every 10 days</p>
        </div>

        <Badge variant={trend.direction === 'up' ? 'success' : trend.direction === 'down' ? 'danger' : 'neutral'}>
          {trend.change > 0 ? '+' : ''}
          {trend.change} points
        </Badge>
      </CardHeader>

      <CardContent className="mt-2">
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="readinessFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={36} />
              <Tooltip
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--popover))',
                  fontSize: 12,
                }}
                formatter={(value: number) => [`${value}/100`, 'Readiness']}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#readinessFill)"
                dot={{ r: 3, strokeWidth: 0, fill: 'hsl(var(--primary))' }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Upcoming events                                                            */
/* -------------------------------------------------------------------------- */

function UpcomingEvents({ state }: { state: ReturnType<typeof useAsync<Registration[]>> }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Upcoming events</CardTitle>
        <Link href="/dashboard/events" className="text-xs font-medium text-primary hover:underline">
          View all
        </Link>
      </CardHeader>

      <CardContent className="mt-4">
        {state.loading ? (
          <CardListSkeleton count={3} />
        ) : state.error ? (
          <ErrorState compact description={state.error} onRetry={() => void state.refetch()} />
        ) : state.data && state.data.length > 0 ? (
          <ul className="space-y-3">
            {state.data.map((registration) => (
              <li key={registration.id}>
                <Link
                  href={`/dashboard/events/pass/${registration.id}`}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
                >
                  <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <span className="text-[10px] font-medium uppercase leading-none">
                      {new Date(registration.event.startAt).toLocaleDateString('en-IN', { month: 'short' })}
                    </span>
                    <span className="text-sm font-bold leading-tight">
                      {new Date(registration.event.startAt).getDate()}
                    </span>
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{registration.event.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {formatEventDate(registration.event.startAt)}
                      {registration.event.venue ? ` · ${registration.event.venue}` : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={registration.status} size="sm" />
                      {registration.status === 'WAITLISTED' && registration.waitlistPosition && (
                        <span className="text-[11px] text-muted-foreground">
                          Position {registration.waitlistPosition}
                        </span>
                      )}
                    </div>
                  </div>

                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={<CalendarDays />}
            title="No upcoming events"
            description="Register for a workshop or club activity — attendance feeds your readiness score."
            action={
              <Button asChild size="sm">
                <Link href="/events">Browse events</Link>
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Applications                                                              */
/* -------------------------------------------------------------------------- */

function ApplicationsPanel({ state }: { state: ReturnType<typeof useAsync<Application[]>> }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Active applications</CardTitle>
        <Link href="/dashboard/applications" className="text-xs font-medium text-primary hover:underline">
          View all
        </Link>
      </CardHeader>

      <CardContent className="mt-4">
        {state.loading ? (
          <CardListSkeleton count={3} />
        ) : state.error ? (
          // A 404 here is expected in Phase 1: the applications module arrives in
          // Phase 3. Rendered as an informative empty state rather than an error.
          <EmptyState
            compact
            icon={<Target />}
            title="Applications open in Phase 3"
            description="Job and internship applications with the full tracker arrive with CareerConnect."
          />
        ) : state.data && state.data.length > 0 ? (
          <ul className="space-y-3">
            {state.data.map((application) => (
              <li
                key={application.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{application.job?.title ?? 'Application'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {application.job?.employer?.companyName ?? 'Company'} · applied{' '}
                    {formatRelative(application.appliedAt)}
                  </p>
                </div>
                <StatusBadge status={application.status} size="sm" />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={<Target />}
            title="No applications yet"
            description="Once you apply to a role, its status shows here so you always know where it stands."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/jobs">Browse jobs</Link>
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

function SkillsPanel({
  passport,
  loading,
}: {
  passport: PassportResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">Loading skills…</span>
          <div className="shimmer h-4 w-28 rounded bg-muted" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="shimmer h-8 w-full rounded bg-muted" />
          ))}
        </div>
      </Card>
    );
  }

  if (!passport || passport.skills.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your skills</CardTitle>
        </CardHeader>
        <CardContent className="mt-4">
          <EmptyState
            compact
            icon={<GraduationCap />}
            title="No skills recorded yet"
            description="Take a short assessment to establish a baseline, or add skills you already have."
            action={
              <Button asChild size="sm">
                <Link href="/dashboard/skills">Get started</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  // Top six by score — the dashboard is a summary, not the full skill page.
  const topSkills = passport.skills.slice(0, 6);

  const chartData = topSkills.map((skill) => ({
    name: skill.name.length > 14 ? `${skill.name.slice(0, 13)}…` : skill.name,
    score: skill.score,
    verified: skill.verified,
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Your strongest skills</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {passport.skills.filter((skill) => skill.verified).length} of {passport.skills.length} verified
          </p>
        </div>
        <Link href="/dashboard/skills" className="text-xs font-medium text-primary hover:underline">
          All skills
        </Link>
      </CardHeader>

      <CardContent className="mt-4">
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                width={96}
              />
              <Tooltip
                formatter={(value: number) => [`${value}/100`, 'Proficiency']}
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--popover))',
                  fontSize: 12,
                }}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={16}>
                {/* Verified skills render in the accent colour, self-declared in muted —
                    so the chart itself communicates which claims are backed by evidence. */}
                {chartData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.verified ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                    fillOpacity={entry.verified ? 1 : 0.45}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" aria-hidden="true" />
            Verified by assessment
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-muted-foreground/45" aria-hidden="true" />
            Self-declared
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Journey derivation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Infers journey stages from the passport data.
 *
 * Derived rather than stored: a stored stage goes stale the moment a certificate
 * is issued by a different code path. Deriving means the stepper cannot disagree
 * with the evidence below it.
 *
 * TODO(Phase 2): extend with assessment, course, roadmap and project signals.
 */
function deriveCompletedStages(passport: PassportResponse | null): string[] {
  if (!passport) return [];

  const completed: string[] = [];

  if (passport.stats.eventsAttended > 0) {
    completed.push('discover', 'participate');
  }
  if (passport.stats.certificatesEarned > 0) {
    completed.push('assess');
  }
  if (passport.readiness.breakdown.skills > 0) {
    completed.push('learn');
  }
  if (passport.stats.projectsCompleted > 0) {
    completed.push('build');
  }
  if (passport.stats.internshipsCompleted > 0) {
    completed.push('experience');
  }
  if (passport.readiness.breakdown.interview > 0) {
    completed.push('prepare');
  }

  return [...new Set(completed)];
}

function deriveCurrentStage(passport: PassportResponse | null): string {
  if (!passport) return 'discover';

  const completed = deriveCompletedStages(passport);

  // The first stage not yet complete is where the student is.
  const order = ['discover', 'participate', 'assess', 'learn', 'build', 'experience', 'prepare', 'apply', 'hired'];
  return order.find((stage) => !completed.includes(stage)) ?? 'hired';
}
