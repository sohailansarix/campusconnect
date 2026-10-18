import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight, BadgeCheck, Briefcase, CalendarDays, CheckCircle2, GraduationCap,
  Play, Quote, Sparkles, Target, TrendingUp, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { MarketingJourney } from '@/components/journey/journey-stepper';
import {
  PLACEHOLDER_PARTNERS,
  PLACEHOLDER_STATS,
  PLACEHOLDER_STATS_NOTE,
  PLACEHOLDER_TESTIMONIALS,
  PLATFORM_FEATURES,
  siteConfig,
} from '@/lib/site-config';
import { layerClasses } from '@/lib/utils';

export const metadata: Metadata = {
  title: `${siteConfig.name} — ${siteConfig.tagline}`,
  description: siteConfig.description,
  // Marketing pages are the only indexable surface in the app.
  robots: { index: true, follow: true },
};

const FEATURE_ICONS = {
  CalendarDays,
  GraduationCap,
  BadgeCheck,
  Briefcase,
  Target,
} as const;

export default function HomePage() {
  return (
    <>
      <Hero />
      <StatsStrip />
      <PlatformFeatures />
      <JourneySection />
      <PassportShowcase />
      <SuccessStories />
      <TrustedBy />
      <FinalCta />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Keep the edge-faded grid on its own layer so its mask never fades the text. */}
      <div className="pointer-events-none absolute inset-0 bg-grid-fade" aria-hidden="true" />
      {/* Ambient glow behind the headline. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-hero-glow" aria-hidden="true" />

      <div className="container relative z-10 py-16 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          {/* Copy */}
          <div className="max-w-2xl">
            <Badge variant="default" className="mb-5" size="lg">
              <Sparkles className="size-3.5" aria-hidden="true" />
              One platform, from first year to first job
            </Badge>

            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              From Campus Experience to{' '}
              <span className="bg-gradient-to-r from-layer-campus-600 via-layer-skill-600 to-layer-career-600 bg-clip-text text-transparent">
                Career Readiness
              </span>
            </h1>

            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Everything you do on campus — the workshops, the competitions, the club work, the
              projects — collects into one verified record. Instead of rebuilding the same story
              into four documents, you build one Career Passport that updates itself and goes with
              every application.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/register">
                  Get Started
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>

              <Button asChild variant="outline" size="lg">
                <Link href="/about#demo">
                  <Play className="size-4" aria-hidden="true" />
                  Watch Video
                </Link>
              </Button>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {['Free for students', 'Verifiable certificates', 'No credit card required'].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Floating card collage */}
          <HeroCollage />
        </div>
      </div>
    </section>
  );
}

/**
 * The floating card collage.
 *
 * Each card depicts one real product surface rather than an abstract illustration —
 * an event card with a real date format, a skill bar with a real percentage, a
 * certificate with a real ID shape. The hero has to promise the thing the product
 * actually delivers.
 */
function HeroCollage() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none" aria-hidden="true">
      {/* Backdrop */}
      <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-layer-campus-100/60 via-layer-skill-100/40 to-layer-career-100/60 blur-2xl dark:from-layer-campus-950/40 dark:via-layer-skill-950/30 dark:to-layer-career-950/40" />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Attending an event */}
        <Card className="shadow-card">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-layer-campus-100 text-layer-campus-700 dark:bg-layer-campus-950 dark:text-layer-campus-400">
              <CalendarDays className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Attend Events</p>
              <p className="mt-0.5 truncate text-sm font-semibold">Power BI Bootcamp</p>
              <p className="mt-1 text-xs text-muted-foreground">Sat, 14 Feb · 10:00 AM</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="success" size="sm">
              <CheckCircle2 className="size-3" />
              Registered
            </Badge>
            <span className="text-xs text-muted-foreground">QR pass ready</span>
          </div>
        </Card>

        {/* Learning */}
        <Card className="shadow-card sm:mt-8">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-layer-skill-100 text-layer-skill-700 dark:bg-layer-skill-950 dark:text-layer-skill-400">
              <TrendingUp className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Learn Skills</p>
              <p className="mt-0.5 truncate text-sm font-semibold">SQL for Analysts</p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {[
              { label: 'Advanced Excel', value: 92 },
              { label: 'Power BI', value: 84 },
              { label: 'SQL', value: 68 },
            ].map((skill) => (
              <div key={skill.label}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{skill.label}</span>
                  <span className="tabular-nums text-muted-foreground">{skill.value}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-layer-skill-500"
                    style={{ width: `${skill.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Certificate */}
        <Card className="shadow-card">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <BadgeCheck className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Get Certified</p>
              <p className="mt-0.5 truncate text-sm font-semibold">Certificate of Participation</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">CC-2026-A7F3K2</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="size-3.5" />
            Public verification link
          </div>
        </Card>

        {/* Internship */}
        <Card className="shadow-card sm:mt-8">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-layer-skill-100 text-layer-skill-700 dark:bg-layer-skill-950 dark:text-layer-skill-400">
              <Briefcase className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Find Internships</p>
              <p className="mt-0.5 truncate text-sm font-semibold">Data Analyst Intern</p>
              <p className="mt-1 text-xs text-muted-foreground">6 months · Remote · ₹20,000/mo</p>
            </div>
          </div>
          <div className="mt-3">
            <Badge variant="info" size="sm">
              87% match
            </Badge>
          </div>
        </Card>

        {/* Career */}
        <Card className="shadow-card sm:col-span-2">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-layer-career-100 text-layer-career-700 dark:bg-layer-career-950 dark:text-layer-career-400">
              <Target className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Land Your Dream Job</p>
              <p className="mt-0.5 truncate text-sm font-semibold">Business Analyst · Northwind Analytics</p>
            </div>
            <Badge variant="purple" size="sm">
              Shortlisted
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {['Applied', 'Interview', 'Offer'].map((stage, index) => (
              <div key={stage} className="text-center">
                <div
                  className={`h-1 rounded-full ${index < 2 ? 'bg-layer-career-500' : 'bg-muted'}`}
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">{stage}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stats strip                                                                */
/* -------------------------------------------------------------------------- */

function StatsStrip() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="container py-10">
        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {PLACEHOLDER_STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <span className="block text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  {stat.value}
                </span>
                <span className="mt-1 block text-sm font-medium">{stat.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{stat.description}</span>
              </dd>
            </div>
          ))}
        </dl>

        {/* Required disclosure: these are fabricated numbers. */}
        <p className="mt-6 text-center text-xs italic text-muted-foreground">({PLACEHOLDER_STATS_NOTE})</p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Platform features                                                          */
/* -------------------------------------------------------------------------- */

function PlatformFeatures() {
  return (
    <section className="cc-section" id="features">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything You Need, In One Platform
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Five things students currently do in five different tools — a notice board, a WhatsApp
            group, a spreadsheet, a certificate folder and a job portal — brought into one journey
            where each step feeds the next.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_FEATURES.map((feature) => {
            const Icon = FEATURE_ICONS[feature.icon as keyof typeof FEATURE_ICONS] ?? CalendarDays;
            const accent = layerClasses(feature.layer);

            return (
              <Card key={feature.key} interactive className="group relative flex flex-col">
                <span className={`flex size-11 items-center justify-center rounded-xl ${accent.bg} ${accent.text}`} aria-hidden="true">
                  <Icon className="size-5" />
                </span>

                <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>

                <Link
                  href={feature.href}
                  className={`mt-4 inline-flex items-center gap-1 text-sm font-medium ${accent.text}`}
                >
                  Explore
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </Card>
            );
          })}

          {/* The passport gets its own callout — it is the centrepiece, not a sixth card. */}
          <Card className="relative flex flex-col justify-between overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.08] to-transparent sm:col-span-2 lg:col-span-1">
            <div>
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
                <Sparkles className="size-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold">The Career Passport</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                One continuously updated profile: education, verified skills, campus experience,
                reviewed projects, internships and certificates — with a Career Readiness score
                broken into four evidence pillars.
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <Button asChild size="sm" variant="outline" className="bg-background">
                <Link href="/passport/rahul-sharma">
                  See an example
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
              <span className="text-xs text-muted-foreground">Live demo profile</span>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Journey                                                                    */
/* -------------------------------------------------------------------------- */

function JourneySection() {
  return (
    <section className="cc-section border-y border-border bg-muted/20">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary" className="mb-4">
            The journey
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Your Journey with CampusConnect
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Seven steps, each building on the last. Nothing you do is wasted, and nothing has to be
            re-entered by hand.
          </p>
        </div>

        <div className="mt-14">
          <MarketingJourney />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Passport showcase                                                          */
/* -------------------------------------------------------------------------- */

function PassportShowcase() {
  const pillars = [
    { label: 'Skills', value: 82, tone: 'bg-layer-skill-500' },
    { label: 'Projects', value: 86, tone: 'bg-layer-campus-500' },
    { label: 'Internship', value: 72, tone: 'bg-layer-career-500' },
    { label: 'Interview', value: 76, tone: 'bg-violet-500' },
  ];

  return (
    <section className="cc-section">
      <div className="container">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Badge variant="default" className="mb-4">
              Showcase feature
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              A profile that proves itself
            </h2>

            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Most student profiles are claims. The Career Passport is evidence: certificates with
              public verification links, projects scored against a rubric by a mentor, skills marked
              verified only when an assessment backs them, and internships an employer can check.
            </p>

            <ul className="mt-6 space-y-3">
              {[
                'Updates automatically from events, courses, projects and interviews',
                'Every certificate carries a unique ID and a public verification URL',
                'Readiness score broken into four pillars, so you know what to fix',
                'Privacy controls — public, employers only, or private',
                'Shareable link, QR code and PDF export for applications',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>

            <Button asChild className="mt-8">
              <Link href="/passport/rahul-sharma">
                View Rahul&apos;s passport
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          {/* Passport preview */}
          <Card className="overflow-hidden p-0 shadow-lifted">
            <div className="border-b border-border bg-gradient-to-r from-primary/[0.08] to-transparent p-5">
              <div className="flex items-center gap-4">
                <span className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
                  RS
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">Rahul Sharma</p>
                  <p className="text-sm text-muted-foreground">BBA · XYZ College · Class of 2027</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Business Analytics · Power BI · SQL</p>
                </div>
              </div>
            </div>

            <div className="p-5">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Career Readiness
                  </p>
                  <p className="mt-1 text-4xl font-bold tracking-tight">
                    79
                    <span className="text-lg font-normal text-muted-foreground">/100</span>
                  </p>
                </div>
                <Badge variant="success">Nearly Ready</Badge>
              </div>

              <div
                className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label="Readiness breakdown across four pillars"
              >
                {pillars.map((pillar) => (
                  <div key={pillar.label} className={pillar.tone} style={{ width: `${pillar.value / 4}%` }} />
                ))}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3">
                {pillars.map((pillar) => (
                  <div key={pillar.label} className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${pillar.tone}`} aria-hidden="true" />
                    <dt className="text-xs text-muted-foreground">{pillar.label}</dt>
                    <dd className="ml-auto text-xs font-medium tabular-nums">{pillar.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="cc-divider my-4" />

              <dl className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: 'Events', value: '14' },
                  { label: 'Certificates', value: '11' },
                  { label: 'Projects', value: '3' },
                ].map((stat) => (
                  <div key={stat.label}>
                    <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
                    <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/60 p-2.5">
                <BadgeCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                <p className="text-xs text-muted-foreground">
                  All certificates publicly verifiable
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Success stories                                                            */
/* -------------------------------------------------------------------------- */

function SuccessStories() {
  return (
    <section className="cc-section border-y border-border bg-muted/20">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary" className="mb-4">
            Success stories
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">What changed for them</h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Placeholder testimonials for layout — the people and outcomes are illustrative.
          </p>
        </div>

        {/*
          A horizontally scrollable rail rather than a JS carousel. It works with a
          trackpad, a touch swipe and keyboard scrolling without any library, and it
          degrades to a vertical stack gracefully.
        */}
        <div className="no-scrollbar mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4">
          {PLACEHOLDER_TESTIMONIALS.map((testimonial) => (
            <Card
              key={testimonial.name}
              className="flex w-[320px] shrink-0 snap-start flex-col sm:w-[380px]"
            >
              <Quote className="size-6 text-primary/30" aria-hidden="true" />

              <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>

              <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {testimonial.name
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{testimonial.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{testimonial.role}</p>
                </div>
                <span className="ml-auto shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  {testimonial.outcome}
                </span>
              </div>
            </Card>
          ))}
        </div>

        <p className="mt-2 text-xs italic text-muted-foreground">
          (Placeholder testimonials — fictional students and outcomes.)
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Trusted by                                                                 */
/* -------------------------------------------------------------------------- */

function TrustedBy() {
  return (
    <section className="py-14">
      <div className="container">
        <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Trusted by colleges and employers
        </p>

        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
          {PLACEHOLDER_PARTNERS.map((partner) => (
            // Typographic marks rather than logo images: a placeholder that looks
            // like a logo is more likely to be mistaken for a real endorsement.
            <li key={partner}>
              <span className="flex items-center gap-2 text-base font-semibold text-muted-foreground/70 grayscale transition-all hover:text-muted-foreground hover:grayscale-0">
                <Users className="size-4" aria-hidden="true" />
                {partner}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-center text-xs italic text-muted-foreground">
          (Placeholder partner names — no real organisation is represented.)
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Final CTA                                                                  */
/* -------------------------------------------------------------------------- */

function FinalCta() {
  return (
    <section className="cc-section">
      <div className="container">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-layer-campus-50 via-background to-layer-career-50 p-8 text-center dark:from-layer-campus-950/40 dark:via-background dark:to-layer-career-950/40 sm:p-14">
          <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-60" aria-hidden="true" />

          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Start building your record today
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Every workshop you attend from now on counts. The earlier you start, the stronger the
              profile an employer sees in your final year.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/register">
                  Create your free account
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/contact?intent=demo">Book a demo for your college</Link>
              </Button>
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              Students join free. Colleges and employers pay only when they hire.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
