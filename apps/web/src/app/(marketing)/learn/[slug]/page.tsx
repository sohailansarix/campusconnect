'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, CheckCircle2, CirclePlay, LockKeyhole, Play, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { useAsync } from '@/hooks/use-api';
import { get, post } from '@/lib/api';
import { useSession } from '@/lib/session';

type Lesson = { id: string; title: string; contentType: string; durationMinutes: number | null; order: number; isPreview: boolean; locked: boolean; content: string | null; videoUrl: string | null; quiz: { passScore: number; questions: { id: string; prompt: string; options: { id: string; text: string }[] }[] } | null };
type Course = { id: string; title: string; slug: string; summary: string | null; description: string; level: string; category: string | null; durationMinutes: number | null; isPremium: boolean; price: number; currency: string; modules: { id: string; title: string; description: string | null; order: number; requiresQuiz: boolean; lessons: Lesson[] }[]; enrollment: { id: string; status: string; progressPct: number; completedLessonIds: string[] } | null; canAccess: boolean };
type QuizResult = { score: number; passed: boolean; correct: number; total: number; explanations: { id: string; correctOptionId: string; selectedOptionId: string | null; explanation: string | null }[] };

export default function CoursePage() {
  const params = useParams<{ slug: string }>();
  const { user } = useSession();
  const course = useAsync<Course>(() => get<Course>(`/courses/${params.slug}`), { deps: [params.slug, user?.id] });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, Record<string, string>>>({});
  const [quizResults, setQuizResults] = React.useState<Record<string, QuizResult>>({});

  const enroll = async () => {
    if (!course.data) return;
    setBusy('enroll');
    try {
      await post(`/courses/${course.data.id}/enroll`);
      await course.refetch();
      toast.success('You are enrolled');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not enroll'); }
    finally { setBusy(null); }
  };

  const markComplete = async (lesson: Lesson) => {
    if (!course.data) return;
    setBusy(lesson.id);
    try {
      await post(`/courses/${course.data.id}/lessons/${lesson.id}/complete`);
      await course.refetch();
      toast.success('Lesson marked complete');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save progress'); }
    finally { setBusy(null); }
  };

  const submitQuiz = async (lesson: Lesson) => {
    if (!course.data) return;
    setBusy(lesson.id);
    try {
      const result = await post<QuizResult>(`/courses/${course.data.id}/lessons/${lesson.id}/quiz`, { answers: answers[lesson.id] ?? {} });
      setQuizResults((current) => ({ ...current, [lesson.id]: result }));
      await course.refetch();
      toast[result.passed ? 'success' : 'error'](result.passed ? 'Checkpoint passed' : `Score ${result.score}%. Review the answers and try again.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not submit quiz'); }
    finally { setBusy(null); }
  };

  if (course.loading) return <div className="mx-auto max-w-5xl p-6"><div className="shimmer h-96 rounded-xl bg-muted" /></div>;
  if (course.error || !course.data) return <div className="mx-auto max-w-5xl p-6"><ErrorState title="Could not load this course" description={course.error ?? 'Course not found'} onRetry={() => void course.refetch()} /></div>;
  const data = course.data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Button asChild variant="ghost" size="sm"><Link href="/learn"><ArrowLeft className="size-4" /> All courses</Link></Button>
      <header className="mt-5 rounded-2xl border bg-gradient-to-br from-teal-50 via-background to-blue-50 p-6 dark:from-teal-950/30 dark:to-blue-950/20 sm:p-8"><div className="flex flex-wrap gap-2"><Badge variant="outline">{data.level.toLowerCase()}</Badge>{data.category && <Badge variant="secondary">{data.category}</Badge>}{data.isPremium && <Badge>Premium</Badge>}</div><h1 className="mt-4 text-3xl font-bold tracking-tight">{data.title}</h1><p className="mt-3 max-w-3xl text-muted-foreground">{data.summary ?? data.description}</p><div className="mt-5 flex flex-wrap items-center gap-3">{data.enrollment ? <div className="min-w-52 flex-1"><div className="flex justify-between text-xs"><span>Course progress</span><span>{data.enrollment.progressPct}%</span></div><div className="mt-2 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${data.enrollment.progressPct}%` }} /></div></div> : user ? <Button loading={busy === 'enroll'} onClick={() => void enroll()}>{data.isPremium ? `Enroll · ₹${Math.round(data.price / 100)}` : 'Enroll for free'}</Button> : <Button asChild><Link href="/login">Sign in to enroll</Link></Button>}</div>{data.isPremium && !data.canAccess && <p className="mt-3 text-xs text-muted-foreground">Premium access is required for the full course. Preview lessons remain open.</p>}</header>
      <div className="mt-7 space-y-4">{data.modules.map((module, moduleIndex) => <Card key={module.id}><CardContent className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Module {moduleIndex + 1}</p><h2 className="mt-1 text-lg font-semibold">{module.title}</h2>{module.description && <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>}</div>{module.requiresQuiz && <Badge variant="outline">Checkpoint</Badge>}</div><div className="mt-4 space-y-3">{module.lessons.map((lesson) => {
        const completed = data.enrollment?.completedLessonIds.includes(lesson.id) ?? false;
        const result = quizResults[lesson.id];
        return <div key={lesson.id} className="rounded-xl border p-4">
          <div className="flex items-center gap-3"><span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${completed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950' : 'bg-muted text-muted-foreground'}`}>{completed ? <Check className="size-4" /> : lesson.locked ? <LockKeyhole className="size-4" /> : lesson.contentType === 'VIDEO' ? <CirclePlay className="size-4" /> : <Play className="size-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{lesson.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{lesson.contentType.toLowerCase()} {lesson.durationMinutes ? `· ${lesson.durationMinutes} min` : ''}{lesson.isPreview ? ' · preview' : ''}</p></div>{completed && <Badge variant="secondary">Complete</Badge>}</div>
          {lesson.locked ? <p className="mt-3 text-sm text-muted-foreground">Enroll to unlock this lesson.</p> : lesson.contentType === 'QUIZ' && lesson.quiz ? <div className="mt-4 space-y-4">{lesson.quiz.questions.map((question, index) => <fieldset key={question.id}><legend className="text-sm font-medium">{index + 1}. {question.prompt}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{question.options.map((option) => <label key={option.id} className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm ${answers[lesson.id]?.[question.id] === option.id ? 'border-primary bg-primary/5' : ''}`}><input type="radio" name={`${lesson.id}-${question.id}`} checked={answers[lesson.id]?.[question.id] === option.id} onChange={() => setAnswers((state) => ({ ...state, [lesson.id]: { ...state[lesson.id], [question.id]: option.id } }))} />{option.text}</label>)}</div></fieldset>)}{result && <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm"><CheckCircle2 className={`size-4 ${result.passed ? 'text-emerald-600' : 'text-amber-600'}`} />Score {result.score}% · {result.passed ? 'passed' : 'not passed'}</div>}<Button size="sm" loading={busy === lesson.id} onClick={() => void submitQuiz(lesson)}>{completed ? 'Review checkpoint' : 'Submit checkpoint'}</Button></div> : <div className="mt-3">{lesson.content && <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{lesson.content}</p>}{lesson.videoUrl && <a className="mt-2 inline-flex text-sm text-primary underline" href={lesson.videoUrl} target="_blank" rel="noreferrer">Open lesson video</a>}{user && data.enrollment && !completed && <Button size="sm" variant="outline" className="mt-4" loading={busy === lesson.id} onClick={() => void markComplete(lesson)}>Mark lesson complete</Button>}</div>}
        </div>;
      })}</div></CardContent></Card>)}</div>
    </div>
  );
}
