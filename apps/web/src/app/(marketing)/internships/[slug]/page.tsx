'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BriefcaseBusiness, CalendarDays, CheckCircle2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Field, Textarea } from '@/components/ui/input';
import { Checkbox, Select } from '@/components/ui/select';
import { useAsync } from '@/hooks/use-api';
import { get, post } from '@/lib/api';
import { useSession } from '@/lib/session';

type Internship = { id: string; title: string; slug: string; description: string; companyName: string; role: string | null; workMode: string; location: string | null; durationMonths: number | null; stipendMonthly: number | null; currency: string; skillIds: string[]; minReadinessScore: number | null; eligibleGraduationYears: number[]; openings: number; isPremium: boolean; opportunityKind: string; applicationDeadline: string | null; startDate: string | null; isCurated: boolean; employer: { companyName: string; isVerified: boolean; logoUrl: string | null; about: string | null } | null };
type Resume = { id: string; title: string; isPrimary: boolean; pdfUrl: string | null };
type Application = { id: string; status: string; internship: { id: string } | null };

export default function InternshipDetailPage() {
  const params = useParams<{ slug: string }>();
  const { user } = useSession();
  const internship = useAsync<Internship>(() => get<Internship>(`/internships/${params.slug}`), { deps: [params.slug] });
  const resumes = useAsync<Resume[]>(() => get<Resume[]>('/resumes/mine'), { enabled: Boolean(user), deps: [user?.id] });
  const applications = useAsync<Application[]>(() => get<Application[]>('/internships/mine/applications'), { enabled: Boolean(user), deps: [user?.id] });
  const [coverNote, setCoverNote] = React.useState('');
  const [resumeId, setResumeId] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  const applied = Boolean(internship.data && applications.data?.some((application) => application.internship?.id === internship.data?.id));

  const apply = async () => {
    if (!internship.data) return;
    setApplying(true);
    try {
      await post(`/internships/${internship.data.id}/apply`, { coverNote, ...(resumeId ? { resumeId } : {}), consentToShare: consent });
      await applications.refetch();
      toast.success('Application submitted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit your application');
    } finally { setApplying(false); }
  };

  if (internship.loading) return <div className="mx-auto max-w-5xl p-6"><div className="shimmer h-80 rounded-xl bg-muted" /></div>;
  if (internship.error || !internship.data) return <div className="mx-auto max-w-5xl p-6"><ErrorState title="Could not load this opportunity" description={internship.error ?? 'Opportunity not found'} onRetry={() => void internship.refetch()} /></div>;
  const item = internship.data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Button asChild variant="ghost" size="sm"><Link href="/internships"><ArrowLeft className="size-4" /> All opportunities</Link></Button>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5"><Card><CardContent className="p-6"><div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><BriefcaseBusiness className="size-6" /></div><div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline">{item.opportunityKind.replaceAll('_', ' ').toLowerCase()}</Badge><Badge variant="secondary">{item.workMode.toLowerCase()}</Badge>{item.isCurated && <Badge variant="outline">College curated</Badge>}{item.isPremium && <Badge>Premium</Badge>}</div><h1 className="mt-3 text-2xl font-bold">{item.title}</h1><p className="mt-1 text-muted-foreground">{item.companyName}{item.role ? ` · ${item.role}` : ''}</p><div className="mt-5 flex flex-wrap gap-4 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin className="size-4" />{item.location ?? item.workMode}</span>{item.durationMonths && <span>{item.durationMonths} months</span>}{item.stipendMonthly && <span>{item.currency} {Math.round(item.stipendMonthly / 100).toLocaleString('en-IN')} / month</span>}{item.applicationDeadline && <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" />Deadline {new Date(item.applicationDeadline).toLocaleDateString('en-IN')}</span>}</div></CardContent></Card><Card><CardContent className="p-6"><h2 className="font-semibold">About the opportunity</h2><p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">{item.description}</p>{item.minReadinessScore && <p className="mt-4 text-sm">Minimum readiness score: <strong>{item.minReadinessScore}/100</strong></p>}{item.eligibleGraduationYears.length > 0 && <p className="mt-2 text-sm">Eligible graduation years: {item.eligibleGraduationYears.join(', ')}</p>}</CardContent></Card>{item.employer?.about && <Card><CardContent className="p-6"><h2 className="font-semibold">About {item.employer.companyName}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{item.employer.about}</p></CardContent></Card>}</div>

        <Card className="h-fit"><CardContent className="space-y-4 p-5"><h2 className="text-lg font-semibold">{applied ? 'Application submitted' : 'Apply for this opportunity'}</h2>{applied ? <><p className="text-sm text-muted-foreground">You can review your status in your internship applications.</p><Badge variant="secondary"><CheckCircle2 className="mr-1 size-3.5" />Application received</Badge><Button asChild variant="outline" className="w-full"><Link href="/dashboard/internships">Track application</Link></Button></> : user ? <><Field label="Attach a resume"><Select value={resumeId} onChange={setResumeId} placeholder="Optional resume" options={(resumes.data ?? []).map((resume) => ({ value: resume.id, label: `${resume.title}${resume.isPrimary ? ' · Primary' : ''}` }))} /></Field><Field label="Cover note"><Textarea rows={5} value={coverNote} onChange={(event) => setCoverNote(event.target.value)} placeholder="Tell the placement team why this opportunity fits your goals." /></Field><div className="flex items-start gap-2 text-xs text-muted-foreground"><Checkbox checked={consent} onChange={setConsent} /><p>I consent to sharing my Career Passport and application with this organisation for this opportunity.</p></div><Button className="w-full" disabled={!consent || applying} loading={applying} onClick={() => void apply()}>Submit application</Button><p className="text-xs text-muted-foreground">Your application is private to the organisation and your college.</p></> : <><p className="text-sm text-muted-foreground">Sign in with your student account to apply. You will choose what information to share for this application.</p><Button asChild className="w-full"><Link href={`/login?next=${encodeURIComponent(`/internships/${item.slug}`)}`}>Sign in to apply</Link></Button></>}</CardContent></Card>
      </div>
    </div>
  );
}
