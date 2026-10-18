'use client';

import * as React from 'react';
import Link from 'next/link';
import { BookOpen, Check, FolderKanban, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { useAsync } from '@/hooks/use-api';
import { get, post } from '@/lib/api';

type ReviewItem = { id: string; status: string; summary: string; submissionNote: string | null; repoUrl: string | null; liveUrl: string | null; submittedAt: string | null; user: { id: string; fullName: string; username: string | null }; project: { id: string; title: string; requirements: string[]; techStack: string[]; difficulty: number } };
type Criterion = { criterion: string; maxPoints: number; score: number; comment: string };

const initialRubric = [
  { criterion: 'Problem understanding', maxPoints: 25, score: 20, comment: '' },
  { criterion: 'Technical execution', maxPoints: 25, score: 20, comment: '' },
  { criterion: 'Evidence and validation', maxPoints: 25, score: 20, comment: '' },
  { criterion: 'Clarity and presentation', maxPoints: 25, score: 20, comment: '' },
];

export default function MentorDashboardPage() {
  const queue = useAsync<ReviewItem[]>(() => get<ReviewItem[]>('/projects/reviews/pending'));
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [rubric, setRubric] = React.useState<Criterion[]>(initialRubric);
  const [feedback, setFeedback] = React.useState('');
  const [strengths, setStrengths] = React.useState('');
  const [improvements, setImprovements] = React.useState('');
  const [decision, setDecision] = React.useState<'APPROVED' | 'NEEDS_REVISION' | 'REJECTED'>('APPROVED');
  const [saving, setSaving] = React.useState(false);

  const review = async (submissionId: string) => {
    setSaving(true);
    try {
      await post(`/projects/submissions/${submissionId}/review`, {
        rubric: rubric.map(({ criterion, maxPoints, score, comment }) => ({ criterion, maxPoints, score, ...(comment ? { comment } : {}) })),
        feedback,
        strengths: strengths.split('\n').map((item) => item.trim()).filter(Boolean),
        improvements: improvements.split('\n').map((item) => item.trim()).filter(Boolean),
        decision,
      });
      setActiveId(null);
      setFeedback('');
      await queue.refetch();
      toast.success(decision === 'APPROVED' ? 'Project approved and added to the student portfolio' : 'Review sent to the student');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save review'); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-6xl space-y-7"><header><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge · Mentor</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Project review queue</h1><p className="mt-2 text-sm text-muted-foreground">Review submitted work against a clear rubric. Approved projects become verified Career Passport evidence.</p><div className="mt-4 flex gap-2"><Button asChild size="sm" variant="outline"><Link href="/learn"><BookOpen className="size-4" />Course catalogue</Link></Button><Button asChild size="sm" variant="outline"><Link href="/dashboard/projects"><FolderKanban className="size-4" />Project briefs</Link></Button></div></header>
    {queue.loading ? <div className="space-y-3">{[0, 1, 2].map((key) => <div key={key} className="shimmer h-36 rounded-xl bg-muted" />)}</div> : queue.error ? <ErrorState title="Could not load review queue" description={queue.error} onRetry={() => void queue.refetch()} /> : queue.data?.length ? <div className="space-y-4">{queue.data.map((item) => <Card key={item.id}><CardContent className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.project.title}</h2><Badge variant="outline">{item.status.replaceAll('_', ' ').toLowerCase()}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{item.user.fullName} · Difficulty {item.project.difficulty}{item.submittedAt ? ` · submitted ${new Date(item.submittedAt).toLocaleDateString('en-IN')}` : ''}</p><p className="mt-3 whitespace-pre-line text-sm">{item.summary}</p><div className="mt-3 flex flex-wrap gap-2">{item.project.techStack.map((tech) => <Badge key={tech} variant="secondary">{tech}</Badge>)}</div><div className="mt-3 flex gap-3 text-sm">{item.repoUrl && <a className="text-primary underline" href={item.repoUrl} target="_blank" rel="noreferrer">Repository</a>}{item.liveUrl && <a className="text-primary underline" href={item.liveUrl} target="_blank" rel="noreferrer">Live project</a>}</div></div><Button size="sm" onClick={() => { setActiveId(activeId === item.id ? null : item.id); setRubric(initialRubric); }}>Review</Button></div>
        {activeId === item.id && <div className="mt-6 space-y-4 border-t pt-5"><h3 className="font-semibold">Rubric score</h3><div className="grid gap-3 sm:grid-cols-2">{rubric.map((criterion, index) => <div key={criterion.criterion} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{criterion.criterion}</p><span className="text-xs text-muted-foreground">/{criterion.maxPoints}</span></div><Input className="mt-2" type="number" min={0} max={criterion.maxPoints} value={criterion.score} onChange={(event) => setRubric((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, score: Math.min(criterion.maxPoints, Math.max(0, Number(event.target.value) || 0)) } : item))} /></div>)}</div><Field label="Review feedback"><Textarea rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Explain what the student did well and what needs improvement." /></Field><div className="grid gap-4 md:grid-cols-2"><Field label="Strengths · one per line"><Textarea rows={3} value={strengths} onChange={(event) => setStrengths(event.target.value)} /></Field><Field label="Improvements · one per line"><Textarea rows={3} value={improvements} onChange={(event) => setImprovements(event.target.value)} /></Field></div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setDecision('NEEDS_REVISION')}>Request revisions</Button><Button loading={saving} onClick={() => void review(item.id)}><Check className="size-4" />{decision === 'NEEDS_REVISION' ? 'Send revision request' : 'Approve project'}</Button></div></div>}
      </CardContent></Card>)}</div> : <EmptyState icon={<FolderKanban />} title="Your review queue is clear" description="Submitted projects from students in your institution will appear here." />}
  </div>;
}
