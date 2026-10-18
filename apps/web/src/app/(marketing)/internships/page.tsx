'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness, CalendarDays, MapPin, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useList } from '@/hooks/use-api';

type Internship = { id: string; title: string; slug: string; companyName: string; companyLogoUrl: string | null; role: string | null; workMode: string; location: string | null; durationMonths: number | null; stipendMonthly: number | null; currency: string; openings: number; isPremium: boolean; opportunityKind: string; applicationDeadline: string | null; isCurated: boolean; employer: { companyName: string; isVerified: boolean; logoUrl: string | null } | null };

export default function InternshipsPage() {
  const [search, setSearch] = React.useState('');
  const [workMode, setWorkMode] = React.useState('');
  const [kind, setKind] = React.useState('');
  const internships = useList<Internship>('/internships', { initialParams: { pageSize: 30 } });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="max-w-3xl"><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Internships and industry projects</h1><p className="mt-3 text-muted-foreground">Find curated internships, apprenticeships and employer projects that build evidence for your Career Passport.</p></header>
      <div className="mt-7 grid gap-3 md:grid-cols-[1fr_190px_220px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search role, company or skill" value={search} onChange={(event) => { setSearch(event.target.value); internships.setFilter({ search: event.target.value || undefined }); }} /></div>
        <Select value={workMode} onChange={(value) => { setWorkMode(value); internships.setFilter({ workMode: value || undefined }); }} options={[{ value: '', label: 'Any work mode' }, { value: 'REMOTE', label: 'Remote' }, { value: 'HYBRID', label: 'Hybrid' }, { value: 'ONSITE', label: 'On-site' }]} />
        <Select value={kind} onChange={(value) => { setKind(value); internships.setFilter({ opportunityKind: value || undefined }); }} options={[{ value: '', label: 'All opportunities' }, { value: 'INTERNSHIP', label: 'Internship' }, { value: 'INDUSTRY_PROJECT', label: 'Industry project' }, { value: 'APPRENTICESHIP', label: 'Apprenticeship' }]} />
      </div>
      <section className="mt-7">
        {internships.loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="shimmer h-56 rounded-xl bg-muted" />)}</div> : internships.error ? <ErrorState title="Could not load opportunities" description={internships.error} onRetry={() => void internships.refetch()} /> : internships.items.length === 0 ? (
          <EmptyState icon={<BriefcaseBusiness />} title="No opportunities match yet" description="Try another search or check back when your college publishes new opportunities." action={<Button variant="outline" onClick={() => { setSearch(''); setWorkMode(''); setKind(''); internships.resetFilters(); }}>Clear filters</Button>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {internships.items.map((item) => <Card key={item.id}><CardContent className="flex h-full flex-col p-5"><div className="flex items-start justify-between gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><BriefcaseBusiness className="size-5" /></div><div className="flex gap-2">{item.isCurated && <Badge variant="outline">College curated</Badge>}{item.isPremium && <Badge>Premium</Badge>}</div></div><p className="mt-4 text-xs text-muted-foreground">{item.companyName}</p><h2 className="mt-1 text-lg font-semibold">{item.title}</h2><p className="mt-1 text-sm text-muted-foreground">{item.role ?? item.opportunityKind.replaceAll('_', ' ').toLowerCase()}</p><div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{item.location ?? item.workMode.toLowerCase()}</span>{item.durationMonths && <span>{item.durationMonths} months</span>}{item.stipendMonthly && <span>{item.currency} {Math.round(item.stipendMonthly / 100).toLocaleString('en-IN')}/month</span>}</div>{item.applicationDeadline && <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />Apply by {new Date(item.applicationDeadline).toLocaleDateString('en-IN')}</p>}<Button asChild size="sm" className="mt-auto pt-5"><Link href={`/internships/${item.slug}`}>View opportunity <ArrowRight className="size-4" /></Link></Button></CardContent></Card>)}
          </div>
        )}
      </section>
    </div>
  );
}
