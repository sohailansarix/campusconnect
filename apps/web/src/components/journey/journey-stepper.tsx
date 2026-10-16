import * as React from 'react';
import { cn } from '@/lib/utils';
import { JOURNEY_STAGES } from '@campusconnect/shared';

/**
 * Journey stepper.
 *
 * The product's narrative spine. It appears in three places at three fidelities:
 *
 *  * `JourneyStepper` — the full nine-stage horizontal rail on the student
 *    dashboard, showing where the student is and what comes next.
 *  * `JourneyProgress` — a compact bar for tight spaces.
 *  * `JourneySteps` — the seven-step numbered list on the marketing page.
 *
 * The stages come from `@campusconnect/shared`, so the marketing page and the
 * product cannot disagree about what the journey is or what order it runs in.
 */

/* -------------------------------------------------------------------------- */
/* Full stepper                                                               */
/* -------------------------------------------------------------------------- */

export interface JourneyStepperProps {
  /** Keys of the stages the student has completed. */
  completed: string[];
  /** Key of the stage currently in progress. */
  current?: string;
  /** Hides stages beyond this one on mobile, so the rail stays legible. */
  compact?: boolean;
  className?: string;
}

export function JourneyStepper({ completed, current, compact, className }: JourneyStepperProps) {
  const completedSet = new Set(completed);

  return (
    <div className={cn('w-full', className)}>
      {/*
        Horizontally scrollable rather than wrapped. Nine stages will not fit on a
        phone, and a wrapped stepper reads as a broken grid — scrolling preserves
        the "one continuous journey" metaphor.
      */}
      <ol
        className="no-scrollbar flex items-start gap-0 overflow-x-auto pb-2"
        aria-label="Your career journey"
      >
        {JOURNEY_STAGES.map((stage, index) => {
          const isComplete = completedSet.has(stage.key);
          const isCurrent = current === stage.key;
          const isLast = index === JOURNEY_STAGES.length - 1;

          return (
            <li key={stage.key} className="flex min-w-[92px] flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* Connector before, except on the first item. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 flex-1',
                    index === 0 && 'invisible',
                    isComplete || isCurrent ? 'bg-primary' : 'bg-border',
                  )}
                />

                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                    isComplete && 'border-primary bg-primary text-primary-foreground',
                    isCurrent && 'border-primary bg-background text-primary',
                    !isComplete && !isCurrent && 'border-border bg-background text-muted-foreground',
                  )}
                  // The state is conveyed visually by colour and shape, which is not
                  // available to a screen reader — this restores it.
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isComplete ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-3.5" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>

                <span
                  aria-hidden="true"
                  className={cn('h-0.5 flex-1', isLast && 'invisible', isComplete ? 'bg-primary' : 'bg-border')}
                />
              </div>

              <span
                className={cn(
                  'mt-2 text-center text-[11px] font-medium leading-tight',
                  isCurrent ? 'text-primary' : isComplete ? 'text-foreground' : 'text-muted-foreground',
                  compact && 'hidden sm:block',
                )}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Compact bar showing overall journey completion. */
export function JourneyProgress({
  completed,
  total = JOURNEY_STAGES.length,
  className,
}: {
  completed: number;
  total?: number;
  className?: string;
}) {
  const percentage = Math.round((completed / total) * 100);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">Journey progress</span>
        <span className="tabular-nums text-muted-foreground">
          {completed} of {total} stages
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-label="Journey progress"
      >
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Marketing step list                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The seven named steps shown on the landing page.
 *
 * These are display labels rather than stage keys, so they are declared here
 * instead of imported — the marketing stepper deliberately groups the nine
 * product stages into seven things a prospective student can hold in their head.
 */
const MARKETING_STEPS = [
  { label: 'Discover', description: 'Find events, clubs and opportunities across your campus.', layer: 'campusconnect' as const },
  { label: 'Participate', description: 'Register in one click and attend with a QR pass that works offline.', layer: 'campusconnect' as const },
  { label: 'Learn', description: 'Assess your skills and follow a roadmap built from your gaps.', layer: 'skillbridge' as const },
  { label: 'Get Certified', description: 'Earn a certificate with a unique ID employers can verify in one click.', layer: 'campusconnect' as const },
  { label: 'Gain Experience', description: 'Build projects reviewed by a mentor and take on an internship.', layer: 'skillbridge' as const },
  { label: 'Prepare', description: 'Build your resume and practise interviews with real feedback.', layer: 'skillbridge' as const },
  { label: 'Get Hired', description: 'Apply with your Career Passport attached and track every step.', layer: 'careerconnect' as const },
];

const LAYER_DOT: Record<'campusconnect' | 'skillbridge' | 'careerconnect', string> = {
  campusconnect: 'bg-layer-campus-600',
  skillbridge: 'bg-layer-skill-600',
  careerconnect: 'bg-layer-career-600',
};

export function MarketingJourney({ className }: { className?: string }) {
  return (
    <ol className={cn('grid gap-6 sm:grid-cols-2 lg:grid-cols-7 lg:gap-4', className)}>
      {MARKETING_STEPS.map((step, index) => (
        <li key={step.label} className="relative flex gap-4 lg:flex-col lg:gap-3">
          {/* Connector line between steps on desktop only. */}
          {index < MARKETING_STEPS.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute left-[15px] top-9 hidden h-[calc(100%-1rem)] w-px bg-border lg:left-4 lg:top-4 lg:h-px lg:w-[calc(100%-1rem)] lg:bg-gradient-to-r lg:from-border lg:to-transparent"
            />
          )}

          <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold">
            <span className={cn('size-2 rounded-full', LAYER_DOT[step.layer])} aria-hidden="true" />
            <span className="sr-only">Step {index + 1}</span>
          </div>

          <div className="space-y-1 pb-6 lg:pb-0">
            <p className="text-sm font-semibold leading-tight">{step.label}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Next-step card                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The "what should I do next" prompt on the student dashboard.
 *
 * A journey with no obvious next action is just a progress bar. This turns the
 * stepper into something actionable by naming exactly one thing and linking to it.
 */
export function NextStepCard({
  title,
  description,
  reason,
  actionLabel,
  actionHref,
  stepLabel,
  className,
}: {
  title: string;
  description: string;
  reason?: string;
  actionLabel: string;
  actionHref: string;
  stepLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
            <path d="m5 12 7-7 7 7M12 19V5" />
          </svg>
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          {stepLabel && (
            <p className="text-[11px] font-medium uppercase tracking-wide text-primary">{stepLabel}</p>
          )}
          <p className="text-sm font-semibold leading-tight">{title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          {reason && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Why: </span>
              {reason}
            </p>
          )}
          <a
            href={actionHref}
            className="mt-1 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {actionLabel}
          </a>
        </div>
      </div>
    </div>
  );
}

export { JOURNEY_STAGES };
