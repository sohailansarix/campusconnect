'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { authSchemas, type LoginInput } from '@campusconnect/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Logo } from '@/components/layout/logo';
import { useSession } from '@/lib/session';
import { ApiError } from '@/lib/api';
import { ROLE_HOME } from '@campusconnect/shared';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useSession();

  const [showPassword, setShowPassword] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(authSchemas.login),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const onSubmit = async (values: LoginInput) => {
    setServerError(null);

    try {
      const user = await signIn(values.email, values.password, values.rememberMe);

      /*
       * `next` wins over the role home so a user who was bounced here from a
       * deep link lands back where they were going. Validation: only accept a
       * relative path, so a crafted `?next=https://evil.example` cannot turn the
       * login page into an open redirect.
       */
      const next = searchParams.get('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

      toast.success(`Welcome back, ${user.fullName.split(' ')[0]}`);
      router.push(safeNext ?? ROLE_HOME[user.role] ?? '/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setServerError(error.message);
      } else {
        setServerError('Could not sign you in. Please try again.');
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
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>

          <Card padding="lg" variant="elevated">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
              <p className="text-sm text-muted-foreground">
                Sign in to your CampusConnect account.
              </p>
            </div>

            {/*
              A single error region for the whole form. Field-level errors are shown
              inline by React Hook Form; this catches credential failures, which have
              no field to attach to — and deliberately does not say *which* of the
              two fields was wrong.
            */}
            {serverError && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5" noValidate>
              <Field
                label="Email address"
                htmlFor="email"
                error={errors.email?.message}
                required
              >
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@college.edu.in"
                  icon={<Mail />}
                  invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </Field>

              <Field label="Password" htmlFor="password" error={errors.password?.message} required>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Your password"
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

              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    {...register('rememberMe')}
                  />
                  Keep me signed in
                </label>

                <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" className="w-full" loading={isSubmitting}>
                Sign in
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              New to CampusConnect?{' '}
              <Link href="/register" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
          </Card>

          <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-dashed border-border bg-muted/30 p-3.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Sessions are protected with rotating refresh tokens. Signing in on a shared computer? Use
              &ldquo;Keep me signed in&rdquo; only on your own device.
            </p>
          </div>

          {/* Demo credentials, so a reviewer can sign in without seeding their own data. */}
          <DemoCredentials />
        </div>
      </main>
    </div>
  );
}

/**
 * Seeded demo accounts.
 *
 * Rendered only in development. In production the API's seed script is not run
 * against live data and these accounts do not exist — showing them would be
 * misleading and mildly unsafe.
 */
function DemoCredentials() {
  if (process.env.NODE_ENV === 'production') return null;

  const accounts = [
    { label: 'Student', email: 'rahul.sharma@xyzcollege.example.edu.in' },
    { label: 'College admin', email: 'placement.officer@xyzcollege.example.edu.in' },
    { label: 'Faculty coordinator', email: 'faculty@xyzcollege.example.edu.in' },
    { label: 'Trainer', email: 'trainer@campusconnect.example' },
    { label: 'Employer', email: 'hiring@northwind-analytics.example' },
    { label: 'Super admin', email: 'admin@campusconnect.example' },
  ];

  return (
    <details className="mt-6 rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Seeded demo accounts (development only)
      </summary>
      <div className="mt-3 space-y-2">
        {accounts.map((account) => (
          <div key={account.email} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{account.label}</span>
            <code className="truncate font-mono text-[11px]">{account.email}</code>
          </div>
        ))}
        <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          Password for all seeded accounts: <code className="font-mono">Password@123</code>
        </p>
      </div>
    </details>
  );
}
