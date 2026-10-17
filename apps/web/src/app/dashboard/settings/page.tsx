'use client';

import * as React from 'react';
import { Save, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { get, patch } from '@/lib/api';
import { useAsync } from '@/hooks/use-api';
import { useSession } from '@/lib/session';

type Profile = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  bio: string | null;
  role: string;
  college: { name: string } | null;
  department: { id: string; name: string; code: string } | null;
  profile: {
    rollNumber: string | null;
    graduationYear: number | null;
    cgpa: number | null;
    headline: string | null;
    location: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
    portfolioUrl: string | null;
    careerInterests: string[];
    passportVisibility: string;
    consentToEmployerSearch: boolean;
  } | null;
};

export default function ProfileSettingsPage() {
  const { user } = useSession();
  const profile = useAsync(() => get<Profile>('/users/me'), { enabled: Boolean(user) });
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ fullName: '', phone: '', bio: '', rollNumber: '', graduationYear: '', cgpa: '', headline: '', location: '', linkedinUrl: '', githubUrl: '', portfolioUrl: '', careerInterests: '', passportVisibility: 'PRIVATE', consentToEmployerSearch: false });

  React.useEffect(() => {
    const value = profile.data;
    if (!value) return;
    setForm({
      fullName: value.fullName,
      phone: value.phone ?? '',
      bio: value.bio ?? '',
      rollNumber: value.profile?.rollNumber ?? '',
      graduationYear: value.profile?.graduationYear?.toString() ?? '',
      cgpa: value.profile?.cgpa?.toString() ?? '',
      headline: value.profile?.headline ?? '',
      location: value.profile?.location ?? '',
      linkedinUrl: value.profile?.linkedinUrl ?? '',
      githubUrl: value.profile?.githubUrl ?? '',
      portfolioUrl: value.profile?.portfolioUrl ?? '',
      careerInterests: value.profile?.careerInterests.join(', ') ?? '',
      passportVisibility: value.profile?.passportVisibility ?? 'PRIVATE',
      consentToEmployerSearch: value.profile?.consentToEmployerSearch ?? false,
    });
  }, [profile.data]);

  const setField = (field: keyof typeof form, value: string | boolean) => setForm((previous) => ({ ...previous, [field]: value }));

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await patch('/users/me', { fullName: form.fullName, phone: form.phone || null, bio: form.bio || null });
      if (profile.data?.profile) {
        await patch('/users/me/student-profile', {
          rollNumber: form.rollNumber || null,
          graduationYear: form.graduationYear ? Number(form.graduationYear) : null,
          cgpa: form.cgpa ? Number(form.cgpa) : null,
          headline: form.headline || null,
          location: form.location || null,
          linkedinUrl: form.linkedinUrl || null,
          githubUrl: form.githubUrl || null,
          portfolioUrl: form.portfolioUrl || null,
          careerInterests: form.careerInterests.split(',').map((interest) => interest.trim()).filter(Boolean),
          passportVisibility: form.passportVisibility,
          consentToEmployerSearch: form.consentToEmployerSearch,
        });
      }
      toast.success('Profile saved');
      await profile.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your profile could not be saved');
    } finally {
      setSaving(false);
    }
  };

  if (profile.loading) return <div className="mx-auto max-w-3xl" aria-busy="true"><div className="shimmer h-[34rem] rounded-2xl bg-muted" /></div>;
  if (profile.error) return <div className="mx-auto max-w-3xl"><ErrorState title="Could not load your profile" description={profile.error} requestId={profile.requestId} onRetry={() => void profile.refetch()} /></div>;
  if (!profile.data) return <EmptyState icon={<UserRound />} title="Profile unavailable" />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div><p className="text-sm font-medium text-primary">Your account</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Profile settings</h1><p className="mt-2 text-sm text-muted-foreground">Keep your campus profile current. Privacy choices control how employers can discover you.</p></div>
      <form onSubmit={save} className="space-y-6">
        <Card className="space-y-5">
          <div><h2 className="font-semibold">Personal details</h2><p className="mt-1 text-xs text-muted-foreground">{profile.data.email}{profile.data.college ? ` · ${profile.data.college.name}` : ''}{profile.data.department ? ` · ${profile.data.department.name}` : ''}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="Full name"><Input required value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} autoComplete="name" /></LabeledField>
            <LabeledField label="Phone"><Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} autoComplete="tel" /></LabeledField>
            <div className="sm:col-span-2"><LabeledField label="About you"><Textarea value={form.bio} onChange={(e) => setField('bio', e.target.value)} maxLength={500} placeholder="A short introduction" /></LabeledField></div>
          </div>
        </Card>

        {profile.data.profile && <>
          <Card className="space-y-5">
            <div><h2 className="font-semibold">Student profile</h2><p className="mt-1 text-xs text-muted-foreground">These details appear in your Career Passport based on the visibility you choose below.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <LabeledField label="Roll number"><Input value={form.rollNumber} onChange={(e) => setField('rollNumber', e.target.value)} /></LabeledField>
              <LabeledField label="Graduation year"><Input type="number" min="2020" max="2040" value={form.graduationYear} onChange={(e) => setField('graduationYear', e.target.value)} /></LabeledField>
              <LabeledField label="CGPA (out of 10)"><Input type="number" min="0" max="10" step="0.01" value={form.cgpa} onChange={(e) => setField('cgpa', e.target.value)} /></LabeledField>
              <LabeledField label="Location"><Input value={form.location} onChange={(e) => setField('location', e.target.value)} placeholder="Pune, Maharashtra" /></LabeledField>
              <div className="sm:col-span-2"><LabeledField label="Career headline"><Input value={form.headline} onChange={(e) => setField('headline', e.target.value)} maxLength={140} placeholder="BBA student interested in business analytics" /></LabeledField></div>
              <LabeledField label="LinkedIn URL"><Input type="url" value={form.linkedinUrl} onChange={(e) => setField('linkedinUrl', e.target.value)} placeholder="https://linkedin.com/in/…" /></LabeledField>
              <LabeledField label="GitHub URL"><Input type="url" value={form.githubUrl} onChange={(e) => setField('githubUrl', e.target.value)} placeholder="https://github.com/…" /></LabeledField>
              <LabeledField label="Portfolio URL"><Input type="url" value={form.portfolioUrl} onChange={(e) => setField('portfolioUrl', e.target.value)} placeholder="https://…" /></LabeledField>
              <LabeledField label="Career interests"><Input value={form.careerInterests} onChange={(e) => setField('careerInterests', e.target.value)} placeholder="Business analytics, marketing" /></LabeledField>
            </div>
          </Card>

          <Card className="space-y-5">
            <div><h2 className="font-semibold">Passport privacy</h2><p className="mt-1 text-xs text-muted-foreground">Employer search consent is explicit and separate from whether you share a public passport link.</p></div>
            <LabeledField label="Who can view your Career Passport"><Select value={form.passportVisibility} onChange={(value) => setField('passportVisibility', value)} options={[{ value: 'PRIVATE', label: 'Private — only me' }, { value: 'EMPLOYERS_ONLY', label: 'Employers with a link' }, { value: 'PUBLIC', label: 'Public' }]} /></LabeledField>
            <label className="flex items-start gap-3 rounded-lg border border-border p-4"><input type="checkbox" checked={form.consentToEmployerSearch} onChange={(event) => setField('consentToEmployerSearch', event.target.checked)} className="mt-0.5 size-4 accent-primary" /><span><span className="block text-sm font-medium">Allow verified employers to find my profile</span><span className="mt-1 block text-xs text-muted-foreground">Only your professional profile and evidence are shared. Contact details remain private.</span></span></label>
          </Card>
        </>}

        <div className="flex justify-end"><Button type="submit" loading={saving}><Save className="size-4" /> Save profile</Button></div>
      </form>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>;
}
