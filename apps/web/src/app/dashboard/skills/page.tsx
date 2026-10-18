'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, Brain, CheckCircle2, Clock3, Target } from 'lucide-react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useAsync, useList } from '@/hooks/use-api';
import { get } from '@/lib/api';

type Assessment = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: 'SKILL' | 'INTEREST';
  durationMinutes: number;
  passScore: number;
  isPremium: boolean;
  category: { id: string; name: string; colorToken: string } | null;
  skill: { id: string; name: string } | null;
  _count: { questions: number };
};

type StudentSkill = {
  id: string;
  score: number;
  proficiency: string;
  source: string;
  isVerified: boolean;
  skill: { id: string; name: string; category: { id: string; name: string; colorToken: string } };
};

type Attempt = {
  id: string;
  score: number | null;
  passed: boolean | null;
  submittedAt: string | null;
  assessment: { id: string; name: string; kind: string };
};

export default function SkillsPage() {
  const assessments = useList<Assessment>('/skills/assessments', { initialParams: { pageSize: 50 } });
  const skills = useAsync<StudentSkill[]>(() => get<StudentSkill[]>('/skills/mine'));
  const attempts = useAsync<Attempt[]>(() => get<Attempt[]>('/skills/assessments/mine/attempts'));

  const chartData = React.useMemo(() => {
    const byCategory = new Map<string, { total: number; count: number }>();
    for (const skill of skills.data ?? []) {
      const item = byCategory.get(skill.skill.category.name) ?? { total: 0, count: 0 };
      item.total += skill.score;
      item.count += 1;
      byCategory.set(skill.skill.category.name, item);
    }
    return [...byCategory.entries()].map(([subject, value]) => ({ subject, score: Math.round(value.total / value.count), fullMark: 100 }));
  }, [skills.data]);

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header>
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Skills and assessments</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Take a short assessment to establish verified skill evidence. Your results update your Career Passport and guide the roadmap.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="font-semibold">Your skill profile</h2><p className="mt-1 text-sm text-muted-foreground">Assessment-backed scores by skill category.</p></div>
              <Badge variant="outline">{skills.data?.filter((item) => item.isVerified).length ?? 0} verified</Badge>
            </div>
            {skills.loading ? <div className="shimmer mt-5 h-64 rounded-lg bg-muted" /> : skills.error ? (
              <ErrorState title="Could not load skills" description={skills.error} onRetry={() => void skills.refetch()} />
            ) : chartData.length === 0 ? (
              <EmptyState compact icon={<Activity />} title="Your profile is ready for a baseline" description="Complete an assessment to add verified skills to your passport." />
            ) : (
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={chartData} outerRadius="75%">
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                    <Tooltip />
                    <Radar dataKey="score" stroke="#0d9488" fill="#14b8a6" fillOpacity={0.25} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
            {skills.data && skills.data.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{skills.data.slice(0, 10).map((item) => <Badge key={item.id} variant={item.isVerified ? 'default' : 'outline'}>{item.skill.name} · {item.score}</Badge>)}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2"><Target className="size-4 text-primary" /><h2 className="font-semibold">Recent results</h2></div>
            {attempts.loading ? <div className="shimmer mt-4 h-44 rounded-lg bg-muted" /> : attempts.error ? (
              <ErrorState title="Could not load attempts" description={attempts.error} onRetry={() => void attempts.refetch()} />
            ) : attempts.data?.length ? (
              <ul className="mt-4 divide-y divide-border">
                {attempts.data.slice(0, 5).map((attempt) => (
                  <li key={attempt.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div><p className="text-sm font-medium">{attempt.assessment.name}</p><p className="mt-1 text-xs text-muted-foreground">{attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleDateString('en-IN') : 'Not submitted'}</p></div>
                    <div className="flex items-center gap-2">{attempt.passed ? <CheckCircle2 className="size-4 text-emerald-600" /> : null}<Badge variant={attempt.passed ? 'default' : 'outline'}>{attempt.score ?? '—'}%</Badge></div>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Your completed assessments will appear here.</p>}
            <Button asChild variant="outline" size="sm" className="mt-5"><Link href="/dashboard/roadmap">View my roadmap <ArrowRight className="size-4" /></Link></Button>
          </CardContent>
        </Card>
      </div>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Assessment catalogue</h2><p className="mt-1 text-sm text-muted-foreground">Skill quizzes are timed. The interest questionnaire has no right answers.</p></div><Badge variant="outline">{assessments.meta?.total ?? assessments.items.length} available</Badge></div>
        {assessments.loading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="shimmer h-44 rounded-xl bg-muted" />)}</div> : assessments.error ? (
          <ErrorState title="Could not load assessments" description={assessments.error} requestId={assessments.requestId} onRetry={() => void assessments.refetch()} />
        ) : assessments.items.length === 0 ? (
          <EmptyState icon={<Brain />} title="No assessments are published yet" description="Your college will add assessments as the SkillBridge catalogue is configured." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {assessments.items.map((assessment) => (
              <Card key={assessment.id} className="flex flex-col">
                <CardContent className="flex h-full flex-col p-5">
                  <div className="flex items-center justify-between gap-2"><Badge variant="outline">{assessment.kind === 'INTEREST' ? 'Career interests' : assessment.category?.name ?? assessment.skill?.name ?? 'Skill'}</Badge>{assessment.isPremium && <Badge variant="secondary">Premium</Badge>}</div>
                  <h3 className="mt-4 font-semibold">{assessment.name}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{assessment.description ?? 'A short assessment to help build your evidence-backed skill profile.'}</p>
                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{assessment.durationMinutes} min</span><span>{assessment._count.questions} questions</span>{assessment.kind === 'SKILL' && <span>Pass {assessment.passScore}%</span>}</div>
                  <Button asChild size="sm" className="mt-auto w-full" disabled={assessment._count.questions === 0}><Link href={`/dashboard/skills/assessments/${assessment.id}`}>{assessment.isPremium ? 'View premium assessment' : 'Start assessment'} <ArrowRight className="size-4" /></Link></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
