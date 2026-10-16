import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { calculateReadiness } from './readiness.service.js';
import { ruleBasedSkillGap } from './skillGap.service.js';
import { ruleBasedResumeReview } from './resume.service.js';
import { ruleBasedJobMatching, rankJobsForCandidate } from './jobMatching.service.js';
import { ruleBasedLearningPath } from './learningPath.service.js';
import { ruleBasedInterview, detectRoleFamily, evaluateAnswer, generateQuestions } from './interview.service.js';
import type { AiServices, RecommendationService, RecommendationInput, RecommendedItem } from './types.js';

/**
 * AI service facade.
 *
 * Features call `ai.readiness.calculate(...)`, never a concrete implementation.
 * `AI_DRIVER` selects the backing service; `rule-based` is the only driver wired
 * today and is also the permanent fallback.
 *
 * The rule-based driver is not a placeholder to be thrown away. Every method it
 * implements stays in the codebase after an LLM is added, because:
 *
 *  - Readiness scoring feeds the passport, is shown to employers, and must be
 *    reproducible and auditable. A model that returns 71 today and 68 tomorrow
 *    for the same evidence is not acceptable there.
 *  - Every AI call needs a path for when the provider is slow, rate-limited or
 *    down. A recommendation panel that 500s is worse than one with slightly
 *    blunter suggestions.
 */

/* -------------------------------------------------------------------------- */
/* Recommendations                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Rule-based recommendation engine.
 *
 * Scores candidate items on four signals, then reports the top contributors as
 * reasons. Explainability matters here: a student who understands *why* an event
 * was surfaced is far more likely to act on it.
 *
 * TODO(AI): collaborative filtering over engagement data once there is enough of
 * it. Cold-start is exactly why this rule-based version is needed first.
 */
class RuleBasedRecommendationService implements RecommendationService {
  async recommendEvents(input: RecommendationInput, limit: number): Promise<RecommendedItem[]> {
    const { prisma } = await import('../../config/prisma.js');

    const events = await prisma.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'ONGOING'] },
        deletedAt: null,
        startAt: { gte: new Date() },
        ...(input.collegeId ? { collegeId: input.collegeId } : {}),
        // Do not recommend an event the student has already registered for.
        registrations: { none: { studentId: input.userId } },
      },
      select: {
        id: true,
        title: true,
        category: true,
        startAt: true,
        venue: true,
        mode: true,
        fee: true,
        tags: true,
        capacity: true,
        registrationCount: true,
        club: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 60,
    });

    const interests = new Set(input.careerInterests.map((i) => i.toLowerCase()));
    const gaps = new Set(input.gapSkills.map((s) => s.toLowerCase()));

    const scored = events.map((event) => {
      const reasons: string[] = [];
      let score = 30; // Baseline: everything recent is mildly relevant.

      // Interest alignment.
      const titleAndTags = `${event.title} ${event.tags.join(' ')}`.toLowerCase();
      const matchedInterest = [...interests].find((interest) => interest.length > 3 && titleAndTags.includes(interest));
      if (matchedInterest) {
        score += 25;
        reasons.push(`Matches your interest in ${matchedInterest}`);
      }

      // Gap-closing potential.
      const matchedGap = [...gaps].find((gap) => gap.length > 3 && titleAndTags.includes(gap));
      if (matchedGap) {
        score += 30;
        reasons.push(`Covers ${matchedGap}, one of your skill gaps`);
      }

      // Imminent events are more actionable.
      const daysUntil = (event.startAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntil <= 3) {
        score += 15;
        reasons.push('Happening in the next few days');
      } else if (daysUntil <= 10) {
        score += 8;
      }

      // Scarcity is a weak positive — it signals interest from peers.
      if (event.capacity > 0) {
        const fillRatio = event.registrationCount / event.capacity;
        if (fillRatio > 0.7 && fillRatio < 1) {
          score += 10;
          reasons.push('Filling up fast');
        }
        if (fillRatio >= 1) score -= 20;
      }

      // Free events convert better for students on a budget.
      if (event.fee === 0) {
        score += 5;
      }

      // Variety: nudge down categories the student has already engaged with
      // heavily, so the feed does not collapse into one interest.
      if (input.recentCategoryIds.includes(event.category)) score -= 5;

      return {
        id: event.id,
        title: event.title,
        score: Math.max(0, Math.min(100, Math.round(score))),
        reasons: reasons.slice(0, 3),
        item: event as unknown as Record<string, unknown>,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async recommendCourses(input: RecommendationInput, limit: number): Promise<RecommendedItem[]> {
    const { prisma } = await import('../../config/prisma.js');

    const courses = await prisma.course.findMany({
      where: {
        isPublished: true,
        deletedAt: null,
        enrollments: { none: { userId: input.userId } },
      },
      select: {
        id: true,
        title: true,
        level: true,
        category: true,
        durationMinutes: true,
        isPremium: true,
        skillIds: true,
        enrollCount: true,
        averageRating: true,
        summary: true,
      },
      orderBy: { enrollCount: 'desc' },
      take: 60,
    });

    // Resolve the skill names behind the ids so gap matching is name-based.
    const allSkillIds = [...new Set(courses.flatMap((course) => course.skillIds))];
    const skills = allSkillIds.length
      ? await prisma.skill.findMany({
          where: { id: { in: allSkillIds } },
          select: { id: true, name: true },
        })
      : [];
    const skillNameById = new Map(skills.map((skill) => [skill.id, skill.name.toLowerCase()]));

    const gaps = new Set(input.gapSkills.map((s) => s.toLowerCase()));
    const strong = new Set(input.strongSkills.map((s) => s.toLowerCase()));

    const scored = courses.map((course) => {
      const reasons: string[] = [];
      let score = 35;

      const courseSkillNames = course.skillIds
        .map((id) => skillNameById.get(id))
        .filter((name): name is string => Boolean(name));

      const closesGap = courseSkillNames.filter((name) => gaps.has(name));
      if (closesGap.length > 0) {
        score += 35;
        reasons.push(`Builds ${closesGap.slice(0, 2).join(' and ')}, which you need`);
      }

      const reinforces = courseSkillNames.filter((name) => strong.has(name));
      if (reinforces.length > 0 && closesGap.length === 0) {
        score += 12;
        reasons.push(`Deepens your existing ${reinforces[0]}`);
      }

      // Popularity is a weak quality signal — enough to break ties, not enough
      // to override a gap match.
      if (course.enrollCount > 100) score += 8;
      else if (course.enrollCount > 30) score += 4;

      if (course.averageRating && Number(course.averageRating) >= 4.3) {
        score += 8;
        reasons.push(`Rated ${Number(course.averageRating).toFixed(1)} by learners`);
      }

      // Free first, for a student audience.
      if (!course.isPremium) score += 5;

      // A course shorter than two hours is easy to start.
      if (course.durationMinutes && course.durationMinutes <= 120) {
        score += 5;
        reasons.push('Under two hours — easy to finish this week');
      }

      return {
        id: course.id,
        title: course.title,
        score: Math.max(0, Math.min(100, Math.round(score))),
        reasons: reasons.slice(0, 3),
        item: course as unknown as Record<string, unknown>,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async recommendOpportunities(input: RecommendationInput, limit: number): Promise<RecommendedItem[]> {
    const { prisma } = await import('../../config/prisma.js');

    // Phase 3 owns the full matcher; this is the dashboard teaser that exists in
    // Phase 1 so the student home page is populated.
    const jobs = await prisma.job.findMany({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        ...(input.collegeId
          ? { OR: [{ eligibleCollegeIds: { isEmpty: true } }, { eligibleCollegeIds: { has: input.collegeId } }] }
          : {}),
      },
      select: {
        id: true,
        title: true,
        workMode: true,
        location: true,
        salaryMin: true,
        salaryMax: true,
        minReadinessScore: true,
        employer: { select: { companyName: true, isVerified: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 40,
    });

    const interests = new Set(input.careerInterests.map((i) => i.toLowerCase()));

    const scored = jobs
      .map((job) => {
        const reasons: string[] = [];
        let score = 35;

        const title = job.title.toLowerCase();
        const matchedInterest = [...interests].find((interest) => interest.length > 3 && title.includes(interest));
        if (matchedInterest) {
          score += 30;
          reasons.push(`Matches your target role: ${matchedInterest}`);
        }

        if (job.employer?.isVerified) {
          score += 10;
          reasons.push('Verified employer');
        }
        if (job.workMode === 'REMOTE') {
          score += 8;
          reasons.push('Remote-friendly');
        }
        if (job.salaryMin) score += 5;

        return {
          id: job.id,
          title: `${job.title} · ${job.employer?.companyName ?? 'Company'}`,
          score: Math.max(0, Math.min(100, Math.round(score))),
          reasons: reasons.slice(0, 3),
          item: job as unknown as Record<string, unknown>,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }
}

/* -------------------------------------------------------------------------- */
/* Facade                                                                     */
/* -------------------------------------------------------------------------- */

const ruleBasedServices: AiServices = {
  driver: 'rule-based',
  readiness: {
    calculate: async (input) => calculateReadiness(input),
  },
  recommendations: new RuleBasedRecommendationService(),
  skillGap: ruleBasedSkillGap,
  resume: ruleBasedResumeReview,
  matching: ruleBasedJobMatching,
  learningPath: ruleBasedLearningPath,
  interview: ruleBasedInterview,
};

let services: AiServices | null = null;

export function getAiServices(): AiServices {
  if (services) return services;

  if (env.AI_DRIVER === 'llm') {
    // TODO(AI): construct `LlmAiServices` here. Until then, log loudly and fall
    // back rather than failing every request that touches a recommendation.
    logger.warn(
      'AI_DRIVER=llm but no LLM implementation is registered — falling back to the rule-based services',
    );
  }

  services = ruleBasedServices;
  return services;
}

/** Test seam. */
export function setAiServices(next: AiServices | null): void {
  services = next;
}

export const ai = {
  readiness: (input: Parameters<AiServices['readiness']['calculate']>[0]) =>
    getAiServices().readiness.calculate(input),
  skillGap: (input: Parameters<AiServices['skillGap']['analyse']>[0]) =>
    getAiServices().skillGap.analyse(input),
  resume: (input: Parameters<AiServices['resume']['review']>[0]) =>
    getAiServices().resume.review(input),
  match: (input: Parameters<AiServices['matching']['score']>[0]) =>
    getAiServices().matching.score(input),
  learningPath: (input: Parameters<AiServices['learningPath']['generate']>[0]) =>
    getAiServices().learningPath.generate(input),
  interviewQuestions: (input: Parameters<AiServices['interview']['generateQuestions']>[0]) =>
    getAiServices().interview.generateQuestions(input),
  evaluateAnswer: (input: Parameters<AiServices['interview']['evaluateAnswer']>[0]) =>
    getAiServices().interview.evaluateAnswer(input),
};

/** Re-exported so callers need only import this module. */
export {
  calculateReadiness,
  rankJobsForCandidate,
  detectRoleFamily,
  generateQuestions,
  evaluateAnswer,
};

export * from './types.js';
