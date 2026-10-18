'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Clock3, FolderKanban, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useList } from '@/hooks/use-api';

type Project = { id: string; title: string; summary: string | null; brief: string; requirements: string[]; techStack: string[]; difficulty: number; estimatedHours: number | null; isPremium: boolean; canAccess: boolean; isCaseStudy: boolean; thumbnailUrl: string | null; course: { id: string; title: string } | null; _count: { submissions: number } };

export default function ProjectsPage() {
  const projects = useList<Project>('/projects', { initialParams: { pageSize: 30 } });
  return <div className="mx-auto max-w-6xl space-y-6"><header><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Projects and portfolio</h1><p className="mt-2 text-sm text-muted-foreground">Choose a brief, build something practical, then submit it for a mentor review. Approved work appears in your Career Passport.</p></header><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search project briefs" onChange={(event) => projects.setFilter({ search: event.target.value || undefined })} /></div>{projects.loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((key) => <div key={key} className="shimmer h-56 rounded-xl bg-muted" />)}</div> : projects.error ? <ErrorState title="Could not load project briefs" description={projects.error} onRetry={() => void projects.refetch()} /> : projects.items.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.items.map((project) => <Card key={project.id}><CardContent className="flex h-full flex-col p-5"><div className="flex items-center justify-between gap-2"><Badge variant="outline">{project.isCaseStudy ? 'Case study' : `Level ${project.difficulty}`}</Badge>{project.isPremium && <Badge>Premium</Badge>}</div><h2 className="mt-4 text-lg font-semibold">{project.title}</h2><p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{project.summary ?? (project.canAccess ? project.brief : 'Unlock the complete project brief and submit your work.')}</p><div className="mt-4 flex flex-wrap gap-2">{project.techStack.slice(0, 4).map((technology) => <Badge key={technology} variant="secondary">{technology}</Badge>)}</div><div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">{project.estimatedHours && <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{project.estimatedHours} hours</span>}<span>{project._count.submissions} submissions</span></div><Button asChild size="sm" className="mt-auto w-full pt-5"><Link href={project.isPremium && !project.canAccess ? '/pricing' : `/dashboard/projects/${project.id}`}>{project.isPremium && !project.canAccess ? 'Explore plans' : 'Open project'} <ArrowRight className="size-4" /></Link></Button></CardContent></Card>)}</div> : <EmptyState icon={<FolderKanban />} title="No project briefs yet" description="Your college or mentors will publish project briefs here." />}</div>;
}
