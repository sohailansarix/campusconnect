'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Clock3, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useList } from '@/hooks/use-api';

type Course = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  thumbnailUrl: string | null;
  level: string;
  category: string | null;
  durationMinutes: number | null;
  isPremium: boolean;
  price: number;
  currency: string;
  enrollCount: number;
  _count: { modules: number; enrollments: number };
  enrolled: boolean;
  enrollment: { status: string; progressPct: number } | null;
};

const levels = [{ value: '', label: 'All levels' }, { value: 'BEGINNER', label: 'Beginner' }, { value: 'INTERMEDIATE', label: 'Intermediate' }, { value: 'ADVANCED', label: 'Advanced' }];

export default function LearnPage() {
  const [search, setSearch] = React.useState('');
  const courses = useList<Course>('/courses', { initialParams: { pageSize: 30 } });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="max-w-3xl"><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Learn skills you can prove</h1><p className="mt-3 text-muted-foreground">Short, practical courses with lessons, checkpoints and progress that feeds your Career Passport.</p></header>
      <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_200px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search courses or skills" value={search} onChange={(event) => { setSearch(event.target.value); courses.setFilter({ search: event.target.value || undefined }); }} /></div>
        <Select value={String(courses.params.level ?? '')} onChange={(level) => courses.setFilter({ level: level || undefined })} options={levels} />
      </div>
      <section className="mt-7">
        {courses.loading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="shimmer h-56 rounded-xl bg-muted" />)}</div> : courses.error ? (
          <ErrorState title="Could not load courses" description={courses.error} requestId={courses.requestId} onRetry={() => void courses.refetch()} />
        ) : courses.items.length === 0 ? (
          <EmptyState icon={<BookOpen />} title="No courses match those filters" description="Try a different search or check back when your college publishes more learning content." action={<Button variant="outline" onClick={() => { setSearch(''); courses.resetFilters(); }}>Clear filters</Button>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {courses.items.map((course) => (
              <Card key={course.id} className="overflow-hidden">
                {course.thumbnailUrl ? <img src={course.thumbnailUrl} alt="" className="h-36 w-full object-cover" /> : <div className="flex h-36 items-center justify-center bg-gradient-to-br from-teal-100 via-cyan-50 to-blue-100 text-teal-700 dark:from-teal-950 dark:via-slate-900 dark:to-blue-950"><BookOpen className="size-9" /></div>}
                <CardContent className="flex h-full flex-col p-5">
                  <div className="flex flex-wrap gap-2"><Badge variant="outline">{course.level.toLowerCase()}</Badge>{course.category && <Badge variant="secondary">{course.category}</Badge>}{course.isPremium && <Badge>Premium</Badge>}</div>
                  <h2 className="mt-3 text-lg font-semibold">{course.title}</h2>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{course.summary ?? 'A practical course with guided lessons and an applied checkpoint.'}</p>
                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{course.durationMinutes ? `${Math.round(course.durationMinutes / 60)} hours` : 'Self-paced'}</span><span>{course._count.modules} modules</span></div>
                  {course.enrollment && <p className="mt-2 text-xs font-medium text-teal-700 dark:text-teal-300">{course.enrollment.progressPct}% complete</p>}
                  <Button asChild variant={course.enrolled ? 'outline' : 'default'} size="sm" className="mt-5 w-full"><Link href={`/learn/${course.slug}`}>{course.enrolled ? 'Continue learning' : course.isPremium ? `View premium course · ₹${Math.round(course.price / 100)}` : 'View course'} <ArrowRight className="size-4" /></Link></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
