'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock3, LockKeyhole } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { useAsync } from '@/hooks/use-api';
import { get, post } from '@/lib/api';

type Question = { id: string; prompt: string; points: number; options: { id: string; text: string; interestTracks?: string[] }[] };
type Assessment = { id: string; name: string; kind: 'SKILL' | 'INTEREST'; description: string | null; durationMinutes: number; passScore: number; isPremium: boolean; questionCount: number; canAttempt: boolean; questions: Question[] };
type StartedAttempt = { attemptId: string; startedAt: string; durationMinutes: number; assessment: { id: string; name: string; kind: string; passScore: number }; questions: Question[] };
type Result = { id: string; kind: string; score: number; passed: boolean; breakdown: Record<string, number>; interests: string[]; correctCount: number; questionCount: number; explanations: { questionId: string; correctOptionId: string; selectedOptionId: string | null; explanation: string | null }[] };

export default function AssessmentPage() {
  const params = useParams<{ assessmentId: string }>();
  const assessmentId = params.assessmentId;
  const assessment = useAsync<Assessment>(() => get<Assessment>(`/skills/assessments/${assessmentId}`), { deps: [assessmentId] });
  const [attempt, setAttempt] = React.useState<StartedAttempt | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<Result | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const autoSubmitted = React.useRef(false);

  const submit = React.useCallback(async () => {
    if (!attempt || submitting || result) return;
    setSubmitting(true);
    try {
      const response = await post<Result>(`/skills/assessments/${assessmentId}/attempts/${attempt.attemptId}/submit`, { answers });
      setResult(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your assessment could not be submitted');
    } finally {
      setSubmitting(false);
    }
  }, [answers, assessmentId, attempt, result, submitting]);

  React.useEffect(() => {
    if (!attempt || result) return;
    const startedAt = new Date(attempt.startedAt).getTime();
    const limit = attempt.durationMinutes * 60;
    const update = () => setSecondsLeft(Math.max(0, limit - Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, result]);

  React.useEffect(() => {
    if (attempt && secondsLeft === 0 && !result && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void submit();
    }
  }, [attempt, result, secondsLeft, submit]);

  const start = async () => {
    setStarting(true);
    try {
      const response = await post<StartedAttempt>(`/skills/assessments/${assessmentId}/attempts`);
      autoSubmitted.current = false;
      setAnswers({});
      setAttempt(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The assessment could not be started');
    } finally {
      setStarting(false);
    }
  };

  const questions = attempt?.questions ?? assessment.data?.questions ?? [];
  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const seconds = (secondsLeft % 60).toString().padStart(2, '0');

  if (assessment.loading) return <div className="mx-auto max-w-3xl"><div className="shimmer h-72 rounded-xl bg-muted" /></div>;
  if (assessment.error || !assessment.data) return <ErrorState title="Could not load the assessment" description={assessment.error ?? 'Assessment not found'} onRetry={() => void assessment.refetch()} />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button variant="ghost" size="sm" asChild><Link href="/dashboard/skills"><ArrowLeft className="size-4" /> Skills and assessments</Link></Button>
      <header><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{assessment.data.kind === 'INTEREST' ? 'Career interests' : 'Skill assessment'}</Badge>{attempt && <Badge variant={secondsLeft < 60 ? 'danger' : 'secondary'}><Clock3 className="mr-1 size-3.5" />{minutes}:{seconds}</Badge>}</div><h1 className="mt-3 text-2xl font-bold tracking-tight">{assessment.data.name}</h1><p className="mt-2 text-sm text-muted-foreground">{assessment.data.description}</p></header>

      {result ? (
        <Card><CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-3"><span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950"><CheckCircle2 className="size-6" /></span><div><h2 className="text-lg font-semibold">{result.kind === 'INTEREST' ? 'Your interests are mapped' : result.passed ? 'Assessment passed' : 'Assessment complete'}</h2><p className="text-sm text-muted-foreground">{result.kind === 'INTEREST' ? 'Your selected interests have been added to your profile.' : `${result.correctCount} of ${result.questionCount} questions correct.`}</p></div></div>
          {result.kind === 'INTEREST' ? <div className="flex flex-wrap gap-2">{result.interests.map((interest) => <Badge key={interest}>{interest}</Badge>)}</div> : <><p className="text-4xl font-bold text-primary">{result.score}<span className="text-lg text-muted-foreground"> / 100</span></p><div className="flex flex-wrap gap-2">{Object.entries(result.breakdown).map(([skill, score]) => <Badge key={skill} variant="outline">{skill}: {score}%</Badge>)}</div><div className="space-y-3">{result.explanations.map((item, index) => <div key={item.questionId} className="rounded-lg border p-3 text-sm"><p className="font-medium">Question {index + 1}: {item.selectedOptionId === item.correctOptionId ? 'Correct' : 'Review this one'}</p>{item.explanation && <p className="mt-1 text-muted-foreground">{item.explanation}</p>}</div>)}</div></>}
          <div className="flex flex-wrap gap-2"><Button asChild><Link href="/dashboard/skills">View skill profile</Link></Button><Button asChild variant="outline"><Link href="/dashboard/roadmap">Open career roadmap</Link></Button></div>
        </CardContent></Card>
      ) : !attempt && !assessment.data.canAttempt ? (
        <Card><CardContent className="space-y-4 p-6"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"><LockKeyhole className="size-5" /></span><div><h2 className="font-semibold">Premium assessment</h2><p className="mt-1 text-sm text-muted-foreground">This {assessment.data.questionCount}-question assessment is available with a Premium Student plan.</p></div></div><Button asChild><Link href="/pricing">Explore plans</Link></Button></CardContent></Card>
      ) : !attempt ? (
        <Card><CardContent className="space-y-4 p-6"><div><p className="text-sm text-muted-foreground">{assessment.data.questionCount} questions · {assessment.data.durationMinutes} minutes</p>{assessment.data.kind === 'SKILL' && <p className="mt-1 text-sm text-muted-foreground">Pass score: {assessment.data.passScore}%. Correct answers are shown after submission.</p>}</div><Button loading={starting} onClick={() => void start()}>Start assessment</Button></CardContent></Card>
      ) : (
        <>
          {questions.map((question, index) => (
            <Card key={question.id}><CardContent className="p-5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Question {index + 1} of {questions.length}</p><h2 className="mt-2 font-medium">{question.prompt}</h2><div className="mt-4 grid gap-2">{question.options.map((option) => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${answers[question.id] === option.id ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'}`}><input className="mt-0.5 accent-primary" type="radio" name={question.id} value={option.id} checked={answers[question.id] === option.id} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))} /><span>{option.text}</span></label>)}</div></CardContent></Card>
          ))}
          <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-soft backdrop-blur"><p className="text-sm text-muted-foreground">{Object.keys(answers).length} answered</p><Button loading={submitting} onClick={() => void submit()}>Submit assessment</Button></div>
        </>
      )}
    </div>
  );
}
