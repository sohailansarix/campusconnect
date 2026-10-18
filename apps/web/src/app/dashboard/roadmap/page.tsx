'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Clock3, Map, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAsync } from '@/hooks/use-api';
import { get, patch, post } from '@/lib/api';

type Track = { id: string; title: string; description: string; skills: { name: string; expectedLevel: string; weight: number }[] };
type Step = { id: string; title: string; description: string | null; actionType: string; targetId: string | null; order: number; estimatedHours: number | null; progress: { id: string; status: string; progressPct: number; completedAt: string | null }[] };
type Roadmap = { id: string; track: string; title: string; summary: string | null; createdAt: string; steps: Step[] };

export default function RoadmapPage() {
  const [track, setTrack] = React.useState('');
  const [weeklyHours, setWeeklyHours] = React.useState('5');
  const tracks = useAsync<Track[]>(() => get<Track[]>('/roadmaps/tracks'));
  const roadmap = useAsync<Roadmap | null>(() => get<Roadmap | null>('/roadmaps/mine'));
  const [generating, setGenerating] = React.useState(false);
  const [updating, setUpdating] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!track && tracks.data?.length) setTrack(tracks.data[0]!.id);
  }, [track, tracks.data]);

  const generate = async () => {
    if (!track) return;
    setGenerating(true);
    try {
      await post('/roadmaps/generate', { track, weeklyHoursAvailable: Number(weeklyHours) || 5 });
      await roadmap.refetch();
      toast.success('Your roadmap is ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not generate your roadmap');
    } finally {
      setGenerating(false);
    }
  };

  const completeStep = async (step: Step) => {
    if (!roadmap.data) return;
    setUpdating(step.id);
    try {
      await patch(`/roadmaps/${roadmap.data.id}/steps/${step.id}`, { status: 'COMPLETED', progressPct: 100 });
      await roadmap.refetch();
      toast.success('Roadmap progress saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update progress');
    } finally {
      setUpdating(null);
    }
  };

  const completedSteps = roadmap.data?.steps.filter((step) => step.progress[0]?.status === 'COMPLETED').length ?? 0;
  const completion = roadmap.data?.steps.length ? Math.round((completedSteps / roadmap.data.steps.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Your career roadmap</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">A practical sequence of courses, projects and assessments based on your current skills and the career track you choose.</p></header>

      <Card><CardContent className="grid gap-4 p-5 md:grid-cols-[1fr_160px_auto] md:items-end">
        <Field label="Career track"><Select value={track} onChange={setTrack} placeholder="Choose a track" disabled={tracks.loading} options={(tracks.data ?? []).map((item) => ({ value: item.id, label: item.title }))} /></Field>
        <Field label="Hours per week"><Input type="number" min={1} max={60} value={weeklyHours} onChange={(event) => setWeeklyHours(event.target.value)} /></Field>
        <Button loading={generating} onClick={() => void generate()}><Sparkles className="size-4" />{roadmap.data ? 'Regenerate roadmap' : 'Generate roadmap'}</Button>
      </CardContent></Card>

      {roadmap.loading ? <div className="shimmer h-80 rounded-xl bg-muted" /> : roadmap.error ? (
        <ErrorState title="Could not load your roadmap" description={roadmap.error} onRetry={() => void roadmap.refetch()} />
      ) : roadmap.data ? (
        <section className="space-y-4">
          <Card><CardContent className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Map className="size-5 text-primary" /><h2 className="text-lg font-semibold">{roadmap.data.title}</h2></div><p className="mt-2 text-sm text-muted-foreground">{roadmap.data.summary}</p></div><Badge variant="outline">{completedSteps}/{roadmap.data.steps.length} complete</Badge></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{completion}% of your plan complete</p></CardContent></Card>
          {roadmap.data.steps.map((step, index) => {
            const status = step.progress[0]?.status ?? 'NOT_STARTED';
            const done = status === 'COMPLETED';
            return <Card key={step.id}><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start"><span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950' : 'bg-primary/10 text-primary'}`}>{done ? <Check className="size-4" /> : <span className="text-sm font-semibold">{index + 1}</span>}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{step.title}</h3><Badge variant="outline">{step.actionType.replaceAll('_', ' ').toLowerCase()}</Badge></div>{step.description && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{step.description}</p>}<p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" />About {step.estimatedHours ?? 1} hours</p></div><div className="flex flex-wrap gap-2">{step.targetId && step.actionType === 'COMPLETE_COURSE' && <Button size="sm" variant="outline" asChild><Link href={`/learn/${step.targetId}`}>Open course <ArrowRight className="size-3.5" /></Link></Button>}{!done && <Button size="sm" loading={updating === step.id} onClick={() => void completeStep(step)}>Mark complete</Button>}</div></CardContent></Card>;
          })}
        </section>
      ) : (
        <EmptyState icon={<Map />} title="Create your first roadmap" description="Choose a career track and weekly study time. We will use your verified skill profile and available courses and projects to make a step-by-step plan." />
      )}
    </div>
  );
}
