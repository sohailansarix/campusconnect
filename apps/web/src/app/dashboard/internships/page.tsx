'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, BriefcaseBusiness, CalendarDays } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useAsync } from '@/hooks/use-api';
import { get } from '@/lib/api';

type Application = { id: string; status: string; appliedAt: string; reviewedAt: string | null; rejectReason: string | null; internship: { id: string; title: string; slug: string; companyName: string; companyLogoUrl: string | null; workMode: string; location: string | null; startDate: string | null; applicationDeadline: string | null } | null };

export default function MyInternshipsPage() {
  const applications = useAsync<Application[]>(() => get<Application[]>('/internships/mine/applications'));
  return <div className="mx-auto max-w-5xl space-y-6"><header><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge</p><h1 className="mt-1 text-2xl font-bold tracking-tight">My internship applications</h1><p className="mt-2 text-sm text-muted-foreground">Track opportunities you applied to and keep your next steps in one place.</p></header>{applications.loading ? <div className="space-y-3">{[0, 1, 2].map((key) => <div key={key} className="shimmer h-28 rounded-xl bg-muted" />)}</div> : applications.error ? <ErrorState title="Could not load applications" description={applications.error} onRetry={() => void applications.refetch()} /> : applications.data?.length ? <div className="space-y-3">{applications.data.map((application) => <Card key={application.id}><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BriefcaseBusiness className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{application.internship?.title ?? 'Opportunity no longer available'}</h2><Badge variant="outline">{application.status.replaceAll('_', ' ').toLowerCase()}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{application.internship?.companyName ?? 'Company'} · {application.internship?.location ?? application.internship?.workMode}</p><p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />Applied {new Date(application.appliedAt).toLocaleDateString('en-IN')}</p>{application.rejectReason && <p className="mt-2 text-sm text-muted-foreground">{application.rejectReason}</p>}</div>{application.internship && <Button asChild size="sm" variant="outline"><Link href={`/internships/${application.internship.slug}`}>View <ArrowUpRight className="size-4" /></Link></Button>}</CardContent></Card>)}</div> : <EmptyState icon={<BriefcaseBusiness />} title="No applications yet" description="Apply to an internship, industry project or apprenticeship and it will appear here." action={<Button asChild><Link href="/internships">Browse opportunities</Link></Button>} />}</div>;
}
