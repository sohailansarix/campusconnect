'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Award, Download, Link2, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useAsync } from '@/hooks/use-api';
import { downloadFile, get, post } from '@/lib/api';

type Passport = { username: string; fullName: string; headline: string | null; visibility: string; readiness: { score: number; band: string; breakdown: Record<string, number> }; careerInterests: string[]; skills: { id: string; name: string; score: number; verified: boolean }[]; projects: { id: string; title: string; rubricScore: number | null }[]; certificates: { certificateId: string; title: string; issuer: string; verified: boolean }[]; stats: { eventsAttended: number; certificatesEarned: number; projectsCompleted: number; internshipsCompleted: number } };
type Share = { shareUrl: string; qrDataUrl: string; shareTargets: { linkedin: string; whatsapp: string }; viewCount: number | null };

export default function PassportDashboardPage() {
  const passport = useAsync<Passport>(() => get<Passport>('/passport/mine'));
  const [share, setShare] = React.useState<Share | null>(null);
  const [shareLoading, setShareLoading] = React.useState(false);

  const loadShare = async () => {
    if (!passport.data) return;
    setShareLoading(true);
    try { setShare(await get<Share>(`/passport/${passport.data.username}/share`)); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not prepare sharing options'); }
    finally { setShareLoading(false); }
  };

  const copyLink = async () => {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.shareUrl); toast.success('Passport link copied'); }
    catch { toast.error('Could not copy the link'); }
  };

  return <div className="mx-auto max-w-6xl space-y-6"><header><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Your evidence profile</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Career Passport</h1><p className="mt-2 text-sm text-muted-foreground">Your education, verified skills, projects, internships and certificates in one shareable profile.</p></header>
    {passport.loading ? <div className="shimmer h-80 rounded-xl bg-muted" /> : passport.error ? <ErrorState title="Could not load your passport" description={passport.error} onRetry={() => void passport.refetch()} /> : passport.data ? <div className="grid gap-6 lg:grid-cols-[1fr_340px]"><div className="space-y-5"><Card><CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center"><div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">{passport.data.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">{passport.data.fullName}</h2><Badge variant="outline">{passport.data.visibility.toLowerCase().replaceAll('_', ' ')}</Badge></div>{passport.data.headline && <p className="mt-1 text-sm text-muted-foreground">{passport.data.headline}</p>}<p className="mt-2 text-sm text-muted-foreground">Readiness {passport.data.readiness.score}/100 · {passport.data.readiness.band}</p></div><Button asChild variant="outline"><Link href={`/passport/${passport.data.username}`}>View public page <ArrowUpRight className="size-4" /></Link></Button></CardContent></Card>
        <div className="grid gap-4 sm:grid-cols-4">{Object.entries(passport.data.stats).map(([key, value]) => <Card key={key}><CardContent className="p-4"><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</p></CardContent></Card>)}</div>
        <Card><CardContent className="p-5"><div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><h2 className="font-semibold">Skills on your passport</h2></div><div className="mt-4 flex flex-wrap gap-2">{passport.data.skills.length ? passport.data.skills.map((skill) => <Badge key={skill.id} variant={skill.verified ? 'default' : 'outline'}>{skill.name} · {skill.score}</Badge>) : <p className="text-sm text-muted-foreground">Take an assessment to add verified skills.</p>}</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="flex items-center gap-2"><Award className="size-4 text-primary" /><h2 className="font-semibold">Evidence included</h2></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{passport.data.projects.slice(0, 4).map((project) => <div key={project.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{project.title}</p><p className="mt-1 text-xs text-muted-foreground">{project.rubricScore === null ? 'Mentor review pending' : `Mentor score ${project.rubricScore}`}</p></div>)}{passport.data.certificates.slice(0, 4).map((certificate) => <div key={certificate.certificateId} className="rounded-lg border p-3"><p className="text-sm font-medium">{certificate.title}</p><p className="mt-1 text-xs text-muted-foreground">{certificate.issuer} · {certificate.verified ? 'Verified' : 'Pending verification'}</p></div>)}</div></CardContent></Card>
        <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/dashboard/settings">Edit profile and privacy</Link></Button><Button asChild variant="outline"><Link href="/dashboard/resume">Build a resume</Link></Button></div></div>
      <aside><Card><CardContent className="p-5"><h2 className="font-semibold">Share your passport</h2><p className="mt-1 text-sm text-muted-foreground">Share only the evidence allowed by your privacy settings.</p>{share ? <><img src={share.qrDataUrl} alt="Career Passport QR code" className="mx-auto mt-4 size-44 rounded-lg border bg-white p-2" /><p className="mt-3 break-all rounded-lg bg-muted p-2 text-xs">{share.shareUrl}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void copyLink()}><Link2 className="size-4" />Copy link</Button><Button size="sm" variant="outline" onClick={() => void downloadFile(`/passport/${passport.data!.username}/export`, `${passport.data!.username}-passport.pdf`)}><Download className="size-4" />PDF</Button></div><div className="mt-3 flex gap-3 text-xs"><a href={share.shareTargets.linkedin} target="_blank" rel="noreferrer" className="text-primary underline">LinkedIn</a><a href={share.shareTargets.whatsapp} target="_blank" rel="noreferrer" className="text-primary underline">WhatsApp</a></div>{share.viewCount !== null && <p className="mt-3 text-xs text-muted-foreground">{share.viewCount} views</p>}</> : <Button className="mt-4 w-full" loading={shareLoading} onClick={() => void loadShare()}><ShieldCheck className="size-4" />Generate sharing QR</Button>}</CardContent></Card><Card className="mt-4"><CardContent className="p-5"><h2 className="font-semibold">Your next steps</h2><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li>• Take skill assessments to verify your skill scores.</li><li>• Submit projects for mentor review.</li><li>• Add completed internships to your evidence.</li></ul></CardContent></Card></aside></div> : <EmptyState icon={<ShieldCheck />} title="Your passport is not ready yet" description="Complete your student profile to create your Career Passport." />}
  </div>;
}
