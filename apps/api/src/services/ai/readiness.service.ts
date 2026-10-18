import { READINESS_WEIGHTS, readinessBand, type ProficiencyLevel } from '@campusconnect/shared';
import type {
  ReadinessInput,
  ReadinessPillar,
  ReadinessResult,
  Suggestion,
} from './types.js';

/**
 * Career Readiness scoring.
 *
 * This is the number on the passport, so the formula is deliberately simple,
 * documented and reproducible. It is a **weighted blend of four evidence
 * pillars**, each scored 0–100:
 *
 *   skills     30%  — proficiency across declared skills, with verified skills
 *                     (assessment-backed) counting more than self-declared ones
 *   projects   25%  — approved submissions, weighted by rubric score and difficulty
 *   internship 25%  — completed internships and industry projects
 *   interview  20%  — mock-interview feedback scores
 *
 * Why weights: a student with strong skills and projects but no interview
 * practice still struggles in a real interview; a student with one internship and
 * nothing else is not yet broadly ready. The blend encodes "evidence across
 * several dimensions beats depth in one".
 *
 * Calibration note: the thresholds are set so a student who has done *nothing*
 * beyond signing up scores near 0, and one with a completed internship, two
 * approved projects, verified skills and two good mock interviews lands in the
 * 80s. They are tuned for a tier-2 Indian college pilot, not for a global
 * percentile — recalibrate against real placement outcomes once there is data.
 *
 * TODO(AI): replace with a model trained on placement outcomes. Keep this
 * function as the deterministic fallback and as the feature-engineering source.
 */

/* -------------------------------------------------------------------------- */
/* Pillar weights and their rationale                                         */
/* -------------------------------------------------------------------------- */

const PILLAR_WEIGHTS = READINESS_WEIGHTS;

/** Multiplier applied to a skill's raw score depending on how it was established. */
const SKILL_SOURCE_WEIGHT: Record<'verified' | 'selfDeclared', number> = {
  // An assessment-backed skill is evidence; a self-declared one is a claim.
  verified: 1.0,
  selfDeclared: 0.7,
};

/**
 * Diminishing returns on breadth.
 *
 * Twelve self-declared skills is not twelve times better than two — past a point
 * it signals dilution. `breadthCredit` rises quickly to 5 skills then flattens,
 * so the pillar rewards *depth* on top of a reasonable base.
 */
function breadthCredit(count: number, saturationPoint: number): number {
  if (count <= 0) return 0;
  // Approaches 1 as count approaches saturationPoint, then creeps up slowly.
  const ratio = count / saturationPoint;
  const bounded = ratio / (1 + Math.max(0, ratio - 1));
  return Math.min(1, bounded);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/* Pillars                                                                    */
/* -------------------------------------------------------------------------- */

function scoreSkills(input: ReadinessInput): ReadinessPillar {
  const { skills } = input;
  if (skills.length === 0) {
    return {
      score: 0,
      rationale: 'No skills recorded yet. Take a skill assessment to establish a baseline.',
    };
  }

  const weighted = skills.map(
    (skill) => skill.score * SKILL_SOURCE_WEIGHT[skill.verified ? 'verified' : 'selfDeclared'],
  );

  // Top-8 average rather than a plain mean: a student with 3 strong skills and 5
  // exploratory ones should not be dragged down by the exploration.
  const top = weighted.sort((a, b) => b - a).slice(0, 8);
  const depth = top.reduce((sum, value) => sum + value, 0) / top.length;

  // Breadth gives up to a 15% lift on top of depth.
  const breadth = breadthCredit(skills.length, 6);
  const score = clamp(depth * (0.85 + 0.15 * breadth));

  const verifiedCount = skills.filter((s) => s.verified).length;
  const categories = new Set(skills.map((s) => s.categoryName)).size;

  return {
    score: round(score),
    rationale: `${skills.length} skill${skills.length === 1 ? '' : 's'} across ${categories} categor${
      categories === 1 ? 'y' : 'ies'
    }, ${verifiedCount} verified by assessment. Scored on your strongest ${top.length}.`,
  };
}

function scoreProjects(input: ReadinessInput): ReadinessPillar {
  const approved = input.projects.filter((p) => p.approved);
  if (approved.length === 0) {
    return {
      score: 0,
      rationale: 'No approved projects yet. A reviewed project is the strongest single signal to an employer.',
    };
  }

  // Each approved project contributes, scaled by its rubric score and difficulty.
  const contributions = approved.map((project) => {
    // A project with no rubric score (approved without review) counts at 70%.
    const quality = project.score !== null ? project.score / 100 : 0.7;
    // Difficulty 1–5; higher difficulty carries more weight but also more risk
    // of a low score, which is the right incentive.
    const difficultyMultiplier = 0.8 + (Math.min(5, Math.max(1, project.difficulty)) - 1) * 0.1;
    return quality * difficultyMultiplier * 100;
  });

  const top = contributions.sort((a, b) => b - a).slice(0, 4);
  const average = top.reduce((sum, value) => sum + value, 0) / top.length;

  // Breadth credit: two projects is meaningfully better than one, four is where
  // it plateaus for a student profile.
  const breadth = breadthCredit(approved.length, 4);
  const score = clamp(average * (0.9 + 0.1 * breadth));

  const scored = approved.filter((p) => p.score !== null);
  const avgRubric = scored.length > 0 ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null;

  const techs = new Set(approved.flatMap((p) => p.techStack));

  return {
    score: round(score),
    rationale:
      `${approved.length} approved project${approved.length === 1 ? '' : 's'}` +
      (avgRubric !== null ? `, average rubric score ${avgRubric}/100` : ', not yet rubric-scored') +
      (techs.size > 0 ? `, using ${techs.size} technolog${techs.size === 1 ? 'y' : 'ies'}.` : '.'),
  };
}

function scoreInternship(input: ReadinessInput): ReadinessPillar {
  const { internships } = input;
  const completed = internships.filter((i) => i.completed);

  if (completed.length === 0) {
    return {
      score: 0,
      rationale: 'No completed internship or industry project yet. This is the pillar employers weight most.',
    };
  }

  // One completed internship is the meaningful threshold; a second adds less.
  const base = completed.length === 1 ? 70 : completed.length === 2 ? 85 : 95;

  // Longer engagements are stronger evidence of reliability.
  const longestMonths = Math.max(...completed.map((i) => i.durationMonths ?? 2));
  const durationBonus = longestMonths >= 6 ? 5 : longestMonths >= 3 ? 2 : 0;

  const score = clamp(base + durationBonus);

  return {
    score: round(score),
    rationale: `${completed.length} completed engagement${
      completed.length === 1 ? '' : 's'
    }${longestMonths > 0 ? `, longest ${longestMonths} month${longestMonths === 1 ? '' : 's'}` : ''}.`,
  };
}

function scoreInterview(input: ReadinessInput): ReadinessPillar {
  const completed = input.interviews.filter((i) => i.completed && i.overallScore !== null);
  if (completed.length === 0) {
    return {
      score: 0,
      rationale: 'No completed mock interview yet. Book one to find out how you actually present.',
    };
  }

  const scores = completed.map((i) => i.overallScore ?? 0);
  // Best-score weighted toward the most recent: improvement should be rewarded,
  // and one bad early attempt should not be permanent.
  const recent = scores.slice(0, 3);
  const average = recent.reduce((sum, s) => sum + s, 0) / recent.length;
  const best = Math.max(...scores);

  // 70% recent average, 30% best — consistency matters more than a single good day.
  const score = clamp(average * 0.7 + best * 0.3);

  const latest = completed[0];
  const weakDimension = [
    { name: 'communication', value: latest?.communicationScore ?? null },
    { name: 'confidence', value: latest?.confidenceScore ?? null },
    { name: 'content', value: latest?.contentScore ?? null },
  ]
    .filter((d) => d.value !== null)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];

  return {
    score: round(score),
    rationale:
      `${completed.length} mock interview${completed.length === 1 ? '' : 's'}, average ${Math.round(average)}/100` +
      (weakDimension ? `; lowest dimension is ${weakDimension.name} (${weakDimension.value}/100).` : '.'),
  };
}

/* -------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Next-best-action generator.
 *
 * Impact estimates are calibrated to the pillar weights: closing the biggest gap
 * in the heaviest pillar yields the most points. Suggestions are sorted by impact
 * so the student's dashboard can show the top two and trust that they matter.
 */
function buildSuggestions(
  input: ReadinessInput,
  pillars: ReadinessResult['pillars'],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const interests = input.careerInterests.length > 0 ? input.careerInterests[0]! : 'your target role';

  // --- Skills ---------------------------------------------------------------
  const verifiedSkills = input.skills.filter((s) => s.verified);
  if (input.skills.length === 0) {
    suggestions.push({
      id: 'assess-baseline',
      title: 'Take a skill assessment',
      description: 'Establish a baseline across your domains so the platform can measure real progress.',
      reason: 'The skills pillar is 30% of your readiness score and currently has no data.',
      impact: Math.round(PILLAR_WEIGHTS.skills * 25),
      actionType: 'TAKE_ASSESSMENT',
      actionUrl: '/dashboard/skills',
      priority: 'HIGH',
    });
  } else if (verifiedSkills.length < 3) {
    suggestions.push({
      id: 'verify-skills',
      title: 'Get your top skills verified',
      description: 'Skills backed by an assessment score count fully; self-declared skills count at 70%.',
      reason: `You have ${input.skills.length} skills but only ${verifiedSkills.length} verified. Verification alone can lift this pillar.`,
      impact: Math.round(PILLAR_WEIGHTS.skills * Math.min(12, (3 - verifiedSkills.length) * 4)),
      actionType: 'TAKE_ASSESSMENT',
      actionUrl: '/dashboard/skills',
      priority: verifiedSkills.length === 0 ? 'HIGH' : 'MEDIUM',
    });
  }

  // --- Projects -------------------------------------------------------------
  const approvedProjects = input.projects.filter((p) => p.approved);
  if (approvedProjects.length === 0) {
    suggestions.push({
      id: 'first-project',
      title: `Build your first portfolio project for ${interests}`,
      description: 'Pick a project brief, submit it, and get rubric feedback from a mentor.',
      reason: 'Employers consistently rate a reviewed project above a listed skill, and this pillar is empty.',
      impact: Math.round(PILLAR_WEIGHTS.projects * 30),
      actionType: 'BUILD_PROJECT',
      actionUrl: '/dashboard/projects',
      priority: 'HIGH',
    });
  } else if (approvedProjects.length < 3) {
    suggestions.push({
      id: 'more-projects',
      title: 'Add another project to your portfolio',
      description: 'Aim for three approved projects — the point where employers stop asking for more evidence.',
      reason: `You have ${approvedProjects.length} approved project${
        approvedProjects.length === 1 ? '' : 's'
      }; the pillar stops rewarding breadth at four.`,
      impact: Math.round(PILLAR_WEIGHTS.projects * 12),
      actionType: 'BUILD_PROJECT',
      actionUrl: '/dashboard/projects',
      priority: 'MEDIUM',
    });
  }

  // --- Internship -----------------------------------------------------------
  if (input.internships.filter((i) => i.completed).length === 0) {
    const hasApplications = false; // Populated by the caller when it has application data.
    suggestions.push({
      id: 'first-internship',
      title: 'Apply to an internship',
      description: 'Even a short industry project counts. Start with curated internships matched to your skills.',
      reason: hasApplications
        ? 'You have applications in progress — keep them moving, and apply to two more this week.'
        : 'This is the heaviest-weighted pillar with no evidence, and the one placement officers screen on first.',
      impact: Math.round(PILLAR_WEIGHTS.internship * 35),
      actionType: 'APPLY',
      actionUrl: '/internships',
      priority: 'HIGH',
    });
  }

  // --- Interview ------------------------------------------------------------
  const completedMocks = input.interviews.filter((i) => i.completed);
  if (completedMocks.length === 0) {
    suggestions.push({
      id: 'first-mock',
      title: 'Book a mock interview',
      description: 'Practise with a mentor, or use self-practice mode with the role question bank.',
      reason: 'Interview assessment is 20% of your score and you have no attempts recorded.',
      impact: Math.round(PILLAR_WEIGHTS.interview * 25),
      actionType: 'BOOK_MOCK',
      actionUrl: '/dashboard/interviews',
      priority: 'MEDIUM',
    });
  } else {
    const latest = completedMocks[0];
    const weak = [
      { name: 'communication', value: latest?.communicationScore },
      { name: 'confidence', value: latest?.confidenceScore },
      { name: 'content', value: latest?.contentScore },
    ]
      .filter((d): d is { name: string; value: number } => typeof d.value === 'number')
      .sort((a, b) => a.value - b.value)[0];

    if (weak && weak.value < 70) {
      suggestions.push({
        id: `improve-${weak.name}`,
        title: `Work on your ${weak.name}`,
        description: `Score ${weak.value}/100 on your last interview. A second attempt focused on this dimension is the fastest lift.`,
        reason: `${weak.name} is your lowest-scoring dimension across recorded mock interviews.`,
        impact: Math.round(PILLAR_WEIGHTS.interview * 10),
        actionType: 'BOOK_MOCK',
        actionUrl: '/dashboard/interviews',
        priority: 'MEDIUM',
      });
    }
  }

  // --- Engagement -----------------------------------------------------------
  if (input.eventsAttended === 0) {
    suggestions.push({
      id: 'attend-event',
      title: 'Attend a workshop or club event',
      description: 'Campus participation feeds your passport and gives you certificates to show.',
      reason: 'No event participation recorded yet — this is the fastest way to start building a track record.',
      impact: 4,
      actionType: 'ATTEND_EVENT',
      actionUrl: '/events',
      priority: 'LOW',
    });
  }

  // Sort by impact, then by priority as a tiebreaker.
  const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return suggestions
    .sort((a, b) => b.impact - a.impact || priorityRank[a.priority] - priorityRank[b.priority])
    .slice(0, 6);
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const pillars = {
    skills: scoreSkills(input),
    projects: scoreProjects(input),
    internship: scoreInternship(input),
    interview: scoreInterview(input),
  };

  // Engagement and certificates act as a small, capped bonus rather than a fifth
  // pillar: they are real signals but should not substitute for evidence. Max +5.
  const engagementBonus = Math.min(
    5,
    input.eventsAttended * 0.5 + input.certificateCount * 0.4,
  );

  const weighted =
    pillars.skills.score * PILLAR_WEIGHTS.skills +
    pillars.projects.score * PILLAR_WEIGHTS.projects +
    pillars.internship.score * PILLAR_WEIGHTS.internship +
    pillars.interview.score * PILLAR_WEIGHTS.interview;

  const score = clamp(Math.round(weighted + engagementBonus));

  return {
    score,
    band: readinessBand(score).label,
    breakdown: {
      skills: Math.round(pillars.skills.score),
      projects: Math.round(pillars.projects.score),
      internship: Math.round(pillars.internship.score),
      interview: Math.round(pillars.interview.score),
    },
    pillars,
    suggestions: buildSuggestions(input, pillars),
    calculatedAt: new Date(),
  };
}

/**
 * Proficiency a given numeric score corresponds to. Kept here rather than in the
 * shared package because it is a scoring concern, not a display label.
 */
export function proficiencyForScore(score: number): ProficiencyLevel {
  if (score >= 85) return 'EXPERT';
  if (score >= 65) return 'ADVANCED';
  if (score >= 40) return 'INTERMEDIATE';
  return 'BEGINNER';
}
