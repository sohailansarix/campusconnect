'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ExternalLink, LockKeyhole, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { useAsync } from '@/hooks/use-api';
import { get, patch, post } from '@/lib/api';

type Review = { totalScore: number; maxScore: number; feedback: string; strengths: string[]; improvements: string[]; decision: string; createdAt: string };
type Submission = { id: string; status: string; repoUrl: string | null; liveUrl: string | null; fileUrl: string | null; thumbnailUrl: string | null; summary: string | null; submissionNote: string | null; score: number | null; submittedAt: string | null; isApproved: boolean; reviews: Review[] };
type Project = { id: string; title: string; summary: string | null; brief: string; requirements: string[]; techStack: string[]; difficulty: number; estimatedHours: number | null; isPremium: boolean; canAccess: boolean; isCaseStudy: boolean; thumbnailUrl: string | null; course: { id: string; title: string } | null; submission: Submission | null };

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const project = useAsync<Project>(() => get<Project>(`/projects/${params.projectId}`), { deps: [params.projectId] });
  const [form, setForm] = React.useState({ summary: '', submissionNote: '', repoUrl: '', liveUrl: '', fileUrl: '', thumbnailUrl: '' });
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const submission = project.data?.submission;
    if (!submission) return;
    setForm({ summary: submission.summary ?? '', submissionNote: submission.submissionNote ?? '', repoUrl: submission.repoUrl ?? '', liveUrl: submission.liveUrl ?? '', fileUrl: submission.fileUrl ?? '', thumbnailUrl: submission.thumbnailUrl ?? '' });
  }, [project.data?.submission]);

  const setField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!project.data) return;
    setSaving(true);
    try {
      if (project.data.submission) await patch(`/projects/submissions/${project.data.submission.id}`, form);
      else await post(`/projects/${project.data.id}/submissions`, form);
      await project.refetch();
      toast.success('Draft saved');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save your submission'); }
    finally { setSaving(false); }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      let submissionId = project.data?.submission?.id;
      if (submissionId) {
        await patch(`/projects/submissions/${submissionId}`, form);
      } else if (project.data) {
        const created = await post<{ id: string }>(`/projects/${project.data.id}/submissions`, form);
        submissionId = created.id;
      }
      if (!submissionId) return;
      await post(`/projects/submissions/${submissionId}/submit`);
      await project.refetch();
      toast.success('Submitted for mentor review');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not submit for review'); }
    finally { setSubmitting(false); }
  };

  if (project.loading) return <div className="mx-auto max-w-4xl p-6"><div className="shimmer h-80 rounded-xl bg-muted" /></div>;
  if (project.error || !project.data) return <div className="mx-auto max-w-4xl p-6"><ErrorState title="Could not load this project" description={project.error ?? 'Project not found'} onRetry={() => void project.refetch()} /></div>;
  const data = project.data;
  const submission = data.submission;
  const canEdit = !submission || ['DRAFT', 'NEEDS_REVISION'].includes(submission.status);

  return <div className="mx-auto max-w-4xl space-y-6"><Button asChild variant="ghost" size="sm"><Link href="/dashboard/projects"><ArrowLeft className="size-4" /> Project briefs</Link></Button><Card><CardContent className="p-6"><div className="flex flex-wrap gap-2"><Badge variant="outline">{data.isCaseStudy ? 'Case study' : `Difficulty ${data.difficulty}`}</Badge>{data.course && <Badge variant="secondary">{data.course.title}</Badge>}</div><h1 className="mt-3 text-2xl font-bold">{data.title}</h1>{data.summary && <p className="mt-2 text-muted-foreground">{data.summary}</p>}<h2 className="mt-6 font-semibold">Project brief</h2><p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{data.brief}</p><div className="mt-5 grid gap-5 md:grid-cols-2"><div><h3 className="text-sm font-semibold">What to include</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{data.requirements.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3 className="text-sm font-semibold">Suggested tools</h3><div className="mt-2 flex flex-wrap gap-2">{data.techStack.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}</div><p className="mt-4 text-sm text-muted-foreground">Estimated effort: {data.estimatedHours ?? 'Flexible'} hours</p></div></div></CardContent></Card>

    {!data.canAccess ? <Card><CardContent className="space-y-4 p-6"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"><LockKeyhole className="size-5" /></span><div><h2 className="font-semibold">Premium project</h2><p className="mt-1 text-sm text-muted-foreground">Upgrade your plan to unlock the brief, requirements and mentor-reviewed portfolio submission.</p></div></div><Button asChild><Link href="/pricing">Explore plans</Link></Button></CardContent></Card> : <>
    {submission?.reviews[0] && <Card><CardContent className="space-y-3 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Mentor feedback</h2><Badge variant={submission.isApproved ? 'default' : 'outline'}>{submission.reviews[0].decision.replaceAll('_', ' ').toLowerCase()} · {submission.reviews[0].totalScore}/{submission.reviews[0].maxScore}</Badge></div><p className="text-sm text-muted-foreground">{submission.reviews[0].feedback}</p>{submission.reviews[0].strengths.length > 0 && <p className="text-sm"><strong>Strengths:</strong> {submission.reviews[0].strengths.join(' · ')}</p>}{submission.reviews[0].improvements.length > 0 && <p className="text-sm"><strong>Next improvements:</strong> {submission.reviews[0].improvements.join(' · ')}</p>}</CardContent></Card>}

    <Card><CardContent className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Your submission</h2><p className="mt-1 text-sm text-muted-foreground">Write what you built and link the work. Mentor-approved projects appear on your passport.</p></div>{submission && <Badge variant="outline">{submission.status.replaceAll('_', ' ').toLowerCase()}</Badge>}</div>{canEdit ? <><Field label="Project summary"><Textarea rows={5} value={form.summary} onChange={(event) => setField('summary', event.target.value)} placeholder="Describe the problem, your approach and what you learned." /></Field><div className="grid gap-4 md:grid-cols-2"><Field label="Repository URL"><Input type="url" value={form.repoUrl} onChange={(event) => setField('repoUrl', event.target.value)} placeholder="https://github.com/…" /></Field><Field label="Live demo URL"><Input type="url" value={form.liveUrl} onChange={(event) => setField('liveUrl', event.target.value)} placeholder="https://…" /></Field></div><Field label="Submission note"><Textarea rows={3} value={form.submissionNote} onChange={(event) => setField('submissionNote', event.target.value)} placeholder="Anything you want your mentor to focus on?" /></Field><div className="flex flex-wrap gap-2"><Button variant="outline" loading={saving} onClick={() => void save()}>Save draft</Button><Button loading={submitting} onClick={() => void submit()}><Send className="size-4" />Submit for review</Button></div></> : <div className="space-y-3 rounded-lg border p-4 text-sm"><p>{submission?.summary}</p><div className="flex flex-wrap gap-3">{submission?.repoUrl && <a className="inline-flex items-center gap-1 text-primary underline" href={submission.repoUrl} target="_blank" rel="noreferrer">Repository <ExternalLink className="size-3.5" /></a>}{submission?.liveUrl && <a className="inline-flex items-center gap-1 text-primary underline" href={submission.liveUrl} target="_blank" rel="noreferrer">Live demo <ExternalLink className="size-3.5" /></a>}{submission?.isApproved && <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" />In portfolio</span>}</div></div>}</CardContent></Card>
    </>}
  </div>;
}
