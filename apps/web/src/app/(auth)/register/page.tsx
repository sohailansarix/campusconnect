'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, GraduationCap } from 'lucide-react';
import { toast } from 'sonner';
import { authSchemas, type RegisterInput } from '@campusconnect/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Logo } from '@/components/layout/logo';
import { useSession } from '@/lib/session';
import { useColleges } from '@/hooks/use-colleges';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Registration.
 *
 * The college picker drives everything downstream — departments, events, clubs —
 * so it is the first field and the department options are scoped to whatever
 * college is selected. Choosing a department before a college would be a bug.
 */
export default function RegisterPage() {
  const router = useRouter();
  const { signUp } = useSession();
  const { colleges, loading: collegesLoading } = useColleges();

  const [showPassword, setShowPassword] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(authSchemas.register),
    defaultValues: {
      role: 'STUDENT',
      acceptedTerms: undefined as unknown as true,
    },
  });

  const selectedCollegeId = watch('collegeId');
  const password = watch('password') ?? '';

  const selectedCollege = colleges.find((college) => college.id === selectedCollegeId);

  const onSubmit = async (values: RegisterInput) => {
    setServerError(null);
    setFieldErrors({});

    try {
      const user = await signUp(values);
      toast.success('Account created', {
        description: 'Check your email to confirm your address.',
      });
      router.push('/dashboard');
      router.refresh();
      void user;
    } catch (error) {
      if (error instanceof ApiError) {
        // Field-level problems (a taken email, a weak password) are attached to
        // the offending input rather than shown as a banner.
        if (error.details && error.details.length > 0) {
          setFieldErrors(error.fieldErrors);
        }
        setServerError(error.message);
      } else {
        setServerError('Could not create your account. Please try again.');
      }
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="container flex h-16 items-center">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="h-7 w-7" />
          <span className="text-[17px] font-bold tracking-tight">
            Campus<span className="text-primary">Connect</span>
          </span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>

          <Card padding="lg" variant="elevated">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
              <p className="text-sm text-muted-foreground">
                Free for students. Takes about a minute.
              </p>
            </div>

            {serverError && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5" noValidate>
              <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message ?? fieldErrors.fullName} required>
                <Input
                  id="fullName"
                  autoComplete="name"
                  placeholder="Rahul Sharma"
                  invalid={Boolean(errors.fullName ?? fieldErrors.fullName)}
                  {...register('fullName')}
                />
              </Field>

              <Field
                label="Email address"
                htmlFor="email"
                error={errors.email?.message ?? fieldErrors.email}
                hint="Use your college email if you have one — it helps us verify you faster."
                required
              >
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@college.edu.in"
                  invalid={Boolean(errors.email ?? fieldErrors.email)}
                  {...register('email')}
                />
              </Field>

              <Field label="Password" htmlFor="password" error={errors.password?.message} required>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>

              {/* Live password requirements, so the rule is visible before it fails. */}
              {password.length > 0 && <PasswordChecklist password={password} />}

              {/* --- College ------------------------------------------------- */}
              <Field
                label="College"
                htmlFor="collegeId"
                error={errors.collegeId?.message ?? fieldErrors.collegeId}
                hint={collegesLoading ? 'Loading colleges…' : undefined}
                required
              >
                <select
                  id="collegeId"
                  disabled={collegesLoading}
                  className={cn(
                    'h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    (errors.collegeId ?? fieldErrors.collegeId) && 'border-destructive',
                  )}
                  {...register('collegeId', {
                    // Clear the department when the college changes, since the old
                    // selection belongs to a different institution.
                    onChange: () => setValue('departmentId', undefined),
                  })}
                >
                  <option value="">Select your college</option>
                  {colleges.map((college) => (
                    <option key={college.id} value={college.id}>
                      {college.name}
                      {college.city ? ` — ${college.city}` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Department only appears once a college is chosen, because the list
                  depends on it. */}
              {selectedCollege && selectedCollege.departments.length > 0 && (
                <Field
                  label="Department"
                  htmlFor="departmentId"
                  error={errors.departmentId?.message}
                  hint="You can change this later from your profile."
                >
                  <select
                    id="departmentId"
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...register('departmentId')}
                  >
                    <option value="">Select your department</option>
                    {selectedCollege.departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name} ({department.code})
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field
                label="Graduation year"
                htmlFor="graduationYear"
                error={errors.graduationYear?.message}
                hint="Used to match you with internships and jobs you are eligible for."
              >
                <select
                  id="graduationYear"
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register('graduationYear', { valueAsNumber: true })}
                >
                  <option value="">Select year</option>
                  {Array.from({ length: 7 }).map((_, index) => {
                    const year = new Date().getFullYear() + index;
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
                </select>
              </Field>

              {/* --- Consent ------------------------------------------------- */}
              {/*
                Terms consent is a hard requirement, not a pre-ticked box. The
                separate disclosure about employer visibility matters because the
                default is employers-only — the student should know that before they
                finish signing up, not discover it later.
              */}
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    {...register('acceptedTerms')}
                  />
                  <span className="leading-relaxed">
                    I agree to the{' '}
                    <Link href="/legal/terms" className="font-medium text-primary hover:underline">
                      Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link href="/legal/privacy" className="font-medium text-primary hover:underline">
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>

                {errors.acceptedTerms && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {errors.acceptedTerms.message}
                  </p>
                )}

                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <GraduationCap className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  Your passport starts as &ldquo;employers only&rdquo; and you control who sees it. You can
                  opt in to employer search — or go fully private — any time from your privacy settings.
                </p>
              </div>

              <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
                Create account
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Are you a college, trainer or employer?{' '}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              Request access
            </Link>{' '}
            — we set up institution accounts directly.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * Live password requirement checklist.
 *
 * Shows which rules pass as the user types. This is friendlier than a single
 * failure message after submit, and it teaches the policy in one interaction
 * rather than three rejections.
 */
function PasswordChecklist({ password }: { password: string }) {
  const rules = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'Contains a letter', met: /[a-zA-Z]/.test(password) },
    { label: 'Contains a number', met: /[0-9]/.test(password) },
    { label: 'Contains a symbol', met: /[^a-zA-Z0-9]/.test(password) },
  ];

  const allMet = rules.every((rule) => rule.met);

  return (
    <ul className="space-y-1.5 rounded-lg bg-muted/40 p-3" aria-live="polite">
      {rules.map((rule) => (
        <li
          key={rule.label}
          className={cn(
            'flex items-center gap-2 text-xs transition-colors',
            rule.met ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
          )}
        >
          <CheckCircle2
            className={cn('size-3.5 shrink-0', !rule.met && 'opacity-40')}
            aria-hidden="true"
          />
          {rule.label}
          <span className="sr-only">{rule.met ? '— met' : '— not met'}</span>
        </li>
      ))}
      {allMet && <li className="pt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">Strong password</li>}
    </ul>
  );
}
