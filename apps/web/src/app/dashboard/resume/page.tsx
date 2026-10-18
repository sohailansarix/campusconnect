'use client';

import * as React from 'react';
import { CheckCircle2, Circle, Download, FileText, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ResumeContent } from '@campusconnect/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAsync } from '@/hooks/use-api';
import { downloadFile, get, patch, post } from '@/lib/api';
import { useSession } from '@/lib/session';

type ResumeRecord = { id: string; title: string; templateId: string; content: ResumeContent; score: number; suggestions: string[]; scoredAt: string | null; isPrimary: boolean; version: number; updatedAt: string };
type ReviewResult = { score: number; band: string; suggestions: { id: string; section: string; severity: string; title: string; detail: string; example?: { before: string; after: string } }[]; sectionScores: Record<string, number> };

const blankContent: ResumeContent = { headline: '', summary: '', phone: '', location: '', linkedinUrl: '', githubUrl: '', portfolioUrl: '', education: [], skills: [], experience: [], projects: [], certifications: [], achievements: [] };
const templates = [{ value: 'classic', label: 'Classic' }, { value: 'modern', label: 'Modern' }, { value: 'minimal', label: 'Minimal' }, { value: 'academic', label: 'Academic' }];

export default function ResumeBuilderPage() {
  const { user } = useSession();
  const resumes = useAsync<ResumeRecord[]>(() => get<ResumeRecord[]>('/resumes/mine'));
  const [selectedId, setSelectedId] = React.useState('');
  const [title, setTitle] = React.useState('My Resume');
  const [templateId, setTemplateId] = React.useState('classic');
  const [content, setContent] = React.useState<ResumeContent>(blankContent);
  const [reviewResult, setReviewResult] = React.useState<ReviewResult | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!resumes.data?.length) return;
    const active = resumes.data.find((resume) => resume.id === selectedId) ?? resumes.data.find((resume) => resume.isPrimary) ?? resumes.data[0]!;
    if (active.id !== selectedId) setSelectedId(active.id);
    setTitle(active.title);
    setTemplateId(active.templateId);
    setContent(active.content);
  }, [resumes.data, selectedId]);

  const setField = <K extends keyof ResumeContent>(key: K, value: ResumeContent[K]) => setContent((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      const payload = { title, templateId, content, isPrimary: true };
      if (selectedId) await patch(`/resumes/${selectedId}`, payload);
      else {
        const created = await post<ResumeRecord>('/resumes', payload);
        setSelectedId(created.id);
      }
      await resumes.refetch();
      toast.success('Resume saved');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save resume'); }
    finally { setSaving(false); }
  };

  const createFromPassport = async () => {
    setSaving(true);
    try {
      const created = await post<ResumeRecord>('/resumes/from-passport');
      setSelectedId(created.id);
      setTitle(created.title);
      setTemplateId(created.templateId);
      setContent(created.content);
      await resumes.refetch();
      toast.success('Resume filled from your Career Passport');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not prefill from passport'); }
    finally { setSaving(false); }
  };

  const review = async () => {
    if (!selectedId) { toast.error('Save your resume before reviewing it'); return; }
    try {
      const result = await post<ReviewResult>(`/resumes/${selectedId}/review`);
      setReviewResult(result);
      await resumes.refetch();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not score resume'); }
  };

  const exportPdf = async () => {
    if (!selectedId) { toast.error('Save your resume before exporting'); return; }
    try { await downloadFile(`/resumes/${selectedId}/pdf`, `${title.replace(/[^a-z0-9_-]+/gi, '-')}.pdf`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not export PDF'); }
  };

  const addExperience = () => setField('experience', [...content.experience, { role: '', organization: '', period: '', bullets: [''] }]);
  const addProject = () => setField('projects', [...content.projects, { title: '', tech: '', bullets: [''] }]);
  const addEducation = () => setField('education', [...content.education, { institution: '', degree: '', year: '', detail: '' }]);

  return <div className="mx-auto max-w-7xl space-y-6"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">SkillBridge</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Resume builder</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Start from your Career Passport, tailor your story, get rule-based feedback and export an ATS-friendly PDF.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" loading={saving} onClick={() => void createFromPassport()}><Sparkles className="size-4" />Prefill from passport</Button><Button loading={saving} onClick={() => void save()}>Save resume</Button></div></header>

    {resumes.loading ? <div className="shimmer h-72 rounded-xl bg-muted" /> : resumes.error ? <ErrorState title="Could not load resumes" description={resumes.error} onRetry={() => void resumes.refetch()} /> : <>
      {resumes.data && resumes.data.length > 0 && <div className="flex flex-wrap items-center gap-3"><Field label="Resume"><Select value={selectedId} onChange={setSelectedId} options={resumes.data.map((resume) => ({ value: resume.id, label: `${resume.title}${resume.isPrimary ? ' · Primary' : ''}` }))} /></Field><Button size="sm" variant="outline" onClick={() => { setSelectedId(''); setTitle('My Resume'); setTemplateId('classic'); setContent(blankContent); setReviewResult(null); }}>New resume</Button></div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Resume title"><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="Template"><Select value={templateId} onChange={setTemplateId} options={templates} /></Field><Field label="Headline"><Input value={content.headline ?? ''} onChange={(event) => setField('headline', event.target.value)} placeholder="Business analytics student" /></Field><Field label="Location"><Input value={content.location ?? ''} onChange={(event) => setField('location', event.target.value)} /></Field><Field label="Phone"><Input value={content.phone ?? ''} onChange={(event) => setField('phone', event.target.value)} /></Field><Field label="LinkedIn URL"><Input value={content.linkedinUrl ?? ''} onChange={(event) => setField('linkedinUrl', event.target.value)} /></Field><Field label="GitHub URL"><Input value={content.githubUrl ?? ''} onChange={(event) => setField('githubUrl', event.target.value)} /></Field><Field label="Portfolio URL"><Input value={content.portfolioUrl ?? ''} onChange={(event) => setField('portfolioUrl', event.target.value)} /></Field><div className="sm:col-span-2"><Field label="Summary"><Textarea rows={4} value={content.summary ?? ''} onChange={(event) => setField('summary', event.target.value)} placeholder="A 2–4 sentence overview of your focus, strongest skills and the role you want." /></Field></div><div className="sm:col-span-2"><Field label="Skills · comma separated"><Input value={content.skills.map((skill) => skill.name).join(', ')} onChange={(event) => setField('skills', event.target.value.split(',').map((name) => name.trim()).filter(Boolean).map((name) => ({ name })))} placeholder="SQL, Power BI, Advanced Excel" /></Field></div></CardContent></Card>

          <Card><CardContent className="space-y-4 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Education</h2><p className="text-xs text-muted-foreground">Keep the most relevant qualification first.</p></div><Button size="sm" variant="outline" onClick={addEducation}><Plus className="size-4" />Add</Button></div>{content.education.map((item, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><Field label="Institution"><Input value={item.institution} onChange={(event) => setField('education', content.education.map((entry, i) => i === index ? { ...entry, institution: event.target.value } : entry))} /></Field><Field label="Degree"><Input value={item.degree ?? ''} onChange={(event) => setField('education', content.education.map((entry, i) => i === index ? { ...entry, degree: event.target.value } : entry))} /></Field><Field label="Year"><Input value={item.year ?? ''} onChange={(event) => setField('education', content.education.map((entry, i) => i === index ? { ...entry, year: event.target.value } : entry))} /></Field><Field label="Detail"><Input value={item.detail ?? ''} onChange={(event) => setField('education', content.education.map((entry, i) => i === index ? { ...entry, detail: event.target.value } : entry))} /></Field></div>)}</CardContent></Card>

          <Card><CardContent className="space-y-4 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Experience</h2><p className="text-xs text-muted-foreground">Internships, campus roles, volunteering and freelance work all count.</p></div><Button size="sm" variant="outline" onClick={addExperience}><Plus className="size-4" />Add</Button></div>{content.experience.map((item, index) => <div key={index} className="space-y-3 rounded-lg border p-3"><div className="grid gap-3 sm:grid-cols-3"><Field label="Role"><Input value={item.role} onChange={(event) => setField('experience', content.experience.map((entry, i) => i === index ? { ...entry, role: event.target.value } : entry))} /></Field><Field label="Organisation"><Input value={item.organization} onChange={(event) => setField('experience', content.experience.map((entry, i) => i === index ? { ...entry, organization: event.target.value } : entry))} /></Field><Field label="Period"><Input value={item.period} onChange={(event) => setField('experience', content.experience.map((entry, i) => i === index ? { ...entry, period: event.target.value } : entry))} placeholder="Jun–Aug 2026" /></Field></div><Field label="Impact bullets · one per line"><Textarea rows={3} value={item.bullets.join('\n')} onChange={(event) => setField('experience', content.experience.map((entry, i) => i === index ? { ...entry, bullets: event.target.value.split('\n') } : entry))} /></Field><Button size="sm" variant="ghost" onClick={() => setField('experience', content.experience.filter((_, i) => i !== index))}><Trash2 className="size-4" />Remove</Button></div>)}</CardContent></Card>

          <Card><CardContent className="space-y-4 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Projects</h2><p className="text-xs text-muted-foreground">Choose projects that prove skills relevant to your target role.</p></div><Button size="sm" variant="outline" onClick={addProject}><Plus className="size-4" />Add</Button></div>{content.projects.map((item, index) => <div key={index} className="space-y-3 rounded-lg border p-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Project"><Input value={item.title} onChange={(event) => setField('projects', content.projects.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry))} /></Field><Field label="Tools"><Input value={item.tech ?? ''} onChange={(event) => setField('projects', content.projects.map((entry, i) => i === index ? { ...entry, tech: event.target.value } : entry))} /></Field></div><Field label="Impact bullets · one per line"><Textarea rows={3} value={item.bullets.join('\n')} onChange={(event) => setField('projects', content.projects.map((entry, i) => i === index ? { ...entry, bullets: event.target.value.split('\n') } : entry))} /></Field><Button size="sm" variant="ghost" onClick={() => setField('projects', content.projects.filter((_, i) => i !== index))}><Trash2 className="size-4" />Remove</Button></div>)}</CardContent></Card>
        </div>

        <aside className="space-y-4"><Card><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Resume score</h2><p className="mt-1 text-sm text-muted-foreground">Rule-based guidance for this draft.</p></div>{reviewResult && <Badge>{reviewResult.score}/100 · {reviewResult.band}</Badge>}</div><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" disabled={!selectedId} onClick={() => void review()}><Sparkles className="size-4" />Review</Button><Button size="sm" disabled={!selectedId} onClick={() => void exportPdf()}><Download className="size-4" />PDF</Button></div>{reviewResult ? <div className="mt-4 space-y-3">{reviewResult.suggestions.map((item) => <div key={item.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{item.title}</p><Badge variant={item.severity === 'CRITICAL' ? 'danger' : 'outline'}>{item.severity.toLowerCase()}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>{item.example && <p className="mt-2 text-xs">Try: <span className="text-muted-foreground">{item.example.after}</span></p>}</div>)}</div> : <EmptyState compact icon={<FileText />} title="Ready for feedback" description="Save your resume, then run the score to see specific improvements." />}</CardContent></Card>
          <Card><CardContent className="p-5"><h2 className="font-semibold">Live preview · {templateId}</h2><p className="mt-1 text-xs text-muted-foreground">A single-column, ATS-friendly layout. Export creates a print-ready PDF.</p><div className={`mt-4 space-y-3 border-t pt-4 ${templateId === 'modern' ? 'border-t-4 border-teal-600' : templateId === 'academic' ? 'font-serif text-center' : templateId === 'minimal' ? 'text-slate-700' : 'border-blue-600'}`}><div><h3 className={`font-bold ${templateId === 'modern' ? 'text-teal-700' : templateId === 'academic' ? 'text-violet-700' : ''}`}>{user?.fullName ?? 'Your Name'}</h3>{content.headline && <p className="text-xs text-muted-foreground">{content.headline}</p>}<p className="mt-1 text-[11px] text-muted-foreground">{user?.email}</p></div>{content.summary && <PreviewSection title="Summary"><p>{content.summary}</p></PreviewSection>}{content.education.length > 0 && <PreviewSection title="Education">{content.education.map((item, index) => <p key={index}><strong>{item.institution}</strong>{item.degree && ` · ${item.degree}`}</p>)}</PreviewSection>}{content.skills.length > 0 && <PreviewSection title="Skills"><p>{content.skills.map((item) => item.name).join(' · ')}</p></PreviewSection>}{content.projects.length > 0 && <PreviewSection title="Projects">{content.projects.map((item, index) => <p key={index}><strong>{item.title}</strong>{item.tech && ` · ${item.tech}`}</p>)}</PreviewSection>}</div></CardContent></Card>
          <Card><CardContent className="p-5"><h2 className="font-semibold">LinkedIn profile checklist</h2><p className="mt-1 text-xs text-muted-foreground">Use the same evidence to keep your public profile consistent.</p><ul className="mt-4 space-y-3">{[
            { label: 'Role-focused headline', done: Boolean(content.headline) },
            { label: 'About section with a clear target role', done: Boolean(content.summary) },
            { label: 'At least five skills', done: content.skills.length >= 5 },
            { label: 'Featured project with an outcome', done: content.projects.some((project) => project.bullets.length > 0) },
            { label: 'Profile link added', done: Boolean(content.linkedinUrl) },
          ].map((item) => <li key={item.label} className="flex items-center gap-2 text-sm">{item.done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}{item.label}</li>)}</ul><div className="mt-4 rounded-lg bg-muted/50 p-3"><p className="text-xs font-semibold">Tips for your profile</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{linkedinTips(content).map((tip) => <li key={tip}>• {tip}</li>)}</ul></div></CardContent></Card>
        </aside>
      </div>
    </>}
  </div>;
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="border-b pb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">{title}</h3><div className="mt-1 space-y-1 text-[11px] text-muted-foreground">{children}</div></section>;
}

function linkedinTips(content: ResumeContent): string[] {
  const tips: string[] = [];
  if (!content.headline) tips.push('Write a headline that pairs your target role with your strongest evidence-backed skill.');
  if (!content.summary) tips.push('Use the About section to explain your focus, proof point and the work you want to do next.');
  if (content.skills.length < 5) tips.push('Add five to ten relevant skills and keep the same wording as your assessment profile.');
  if (!content.projects.some((project) => project.bullets.length > 0)) tips.push('Feature one reviewed project with a measurable outcome and a link to the work.');
  if (!content.linkedinUrl) tips.push('Add your public LinkedIn URL so recruiters can open the profile from your resume.');
  return tips.length ? tips.slice(0, 3) : ['Your core profile is covered. Keep your headline and featured work in sync with your newest passport evidence.'];
}
