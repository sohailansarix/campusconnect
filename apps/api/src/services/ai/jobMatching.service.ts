import { PROFICIENCY_SCORE, type ProficiencyLevel } from '@campusconnect/shared';
import type {
  CandidateMatchInput,
  JobMatchingService,
  MatchResult,
} from './types.js';

/**
 * Candidate ↔ opportunity matching.
 *
 * A transparent, additive scoring model. Every factor returns its own 0–100 score
 * and a sentence explaining it, so the employer's shortlist screen can show *why*
 * a candidate ranked where they did. An unexplainable match score invites both
 * distrust from employers and bias complaints from candidates.
 *
 * Two-stage design:
 *   1. Hard eligibility (degree, graduation year, college, minimum readiness) —
 *      failures are reported as `disqualified` with a reason rather than as a low
 *      score, so a recruiter can filter confidently.
 *   2. Weighted scoring across skills, experience, readiness and location.
 *
 * TODO(AI): replace the skill-similarity step with embeddings so "Power BI" and
 * "business intelligence tooling" are recognised as related. Keep this as the
 * fallback — an employer must never see an empty shortlist because a model was
 * unavailable.
 */

/* -------------------------------------------------------------------------- */
/* Factor weights                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Weights sum to 1. Skill overlap dominates because it is what recruiters filter
 * on first and what correlates most with a successful placement.
 */
const FACTOR_WEIGHTS = {
  skills: 0.45,
  readiness: 0.2,
  experience: 0.2,
  location: 0.1,
  interest: 0.05,
} as const;

const LEVEL_SCORE: Record<ProficiencyLevel, number> = PROFICIENCY_SCORE;

type Factor = MatchResult['factors'][number];

function factor(name: string, score: number, weight: number, reason: string): Factor {
  return { name, score: Math.max(0, Math.min(100, Math.round(score))), weight, reason };
}

/* -------------------------------------------------------------------------- */
/* Hard eligibility                                                           */
/* -------------------------------------------------------------------------- */

function checkEligibility(input: CandidateMatchInput): { disqualified: boolean; reason?: string } {
  const { candidate, job } = input;

  // Graduation year — an empty list means "all years".
  if (
    job.eligibleGraduationYears.length > 0 &&
    candidate.graduationYear !== null &&
    !job.eligibleGraduationYears.includes(candidate.graduationYear)
  ) {
    return {
      disqualified: true,
      reason: `This posting is open to the ${job.eligibleGraduationYears.join(', ')} graduating batch; the candidate graduates in ${candidate.graduationYear}.`,
    };
  }

  // College allowlist — an empty list means "all colleges".
  if (
    job.eligibleCollegeIds.length > 0 &&
    candidate.collegeId !== null &&
    !job.eligibleCollegeIds.includes(candidate.collegeId)
  ) {
    return { disqualified: true, reason: 'This posting is limited to specific partner institutions.' };
  }

  // Minimum readiness is an employer-declared floor. Candidates below it are
  // excluded rather than merely down-ranked — otherwise the filter is a lie.
  if (job.minReadinessScore !== null && candidate.readinessScore < job.minReadinessScore) {
    return {
      disqualified: true,
      reason: `Requires a Career Readiness score of ${job.minReadinessScore}; the candidate is at ${candidate.readinessScore}.`,
    };
  }

  return { disqualified: false };
}

/* -------------------------------------------------------------------------- */
/* Factors                                                                    */
/* -------------------------------------------------------------------------- */

function scoreSkills(input: CandidateMatchInput): { factor: Factor; strengths: string[]; gaps: string[] } {
  const { candidate, job } = input;

  if (job.requiredSkills.length === 0) {
    // No declared skill requirements: fall back to the candidate's breadth so the
    // factor is neutral rather than artificially perfect.
    const breadth = Math.min(100, candidate.skills.length * 12);
    return {
      factor: factor('Skills', breadth, FACTOR_WEIGHTS.skills, 'The posting does not list specific skill requirements.'),
      strengths: [],
      gaps: [],
    };
  }

  const byName = new Map(candidate.skills.map((s) => [s.name.trim().toLowerCase(), s]));

  const strengths: string[] = [];
  const gaps: string[] = [];
  let weightedCoverage = 0;
  let totalWeight = 0;

  for (const required of job.requiredSkills) {
    totalWeight += required.weight;
    const held = byName.get(required.name.trim().toLowerCase());
    const expected = LEVEL_SCORE[required.minLevel];

    if (!held) {
      gaps.push(required.name);
      // A missing required skill covers none of its weight; a missing optional
      // one costs less by virtue of its lower weight.
      continue;
    }

    const coverage = expected > 0 ? Math.min(1, held.score / expected) : 1;
    weightedCoverage += required.weight * coverage;

    if (coverage >= 0.95) strengths.push(required.name);
    else if (coverage < 0.6) gaps.push(required.name);
  }

  const score = totalWeight > 0 ? (weightedCoverage / totalWeight) * 100 : 0;

  const reason =
    strengths.length > 0
      ? `Meets ${strengths.length} of ${job.requiredSkills.length} listed skills: ${strengths.slice(0, 3).join(', ')}.`
      : `No listed skills fully met yet (${job.requiredSkills.length} required).`;

  return { factor: factor('Skills', score, FACTOR_WEIGHTS.skills, reason), strengths, gaps };
}

function scoreReadiness(input: CandidateMatchInput): Factor {
  // Readiness is already a 0–100 composite, so it maps directly. Comparing it
  // against a floor gives the employer a familiar percentile-shaped number.
  const floor = input.job.minReadinessScore ?? 60;
  const score = input.candidate.readinessScore;

  const reason =
    score >= floor
      ? `Career Readiness ${score}/100, above the ${floor} threshold for this posting.`
      : `Career Readiness ${score}/100, below the ${floor} threshold.`;

  return factor('Readiness', score, FACTOR_WEIGHTS.readiness, reason);
}

function scoreExperience(input: CandidateMatchInput): Factor {
  const { candidate, job } = input;

  // Internship experience carries the most weight here — it is the closest proxy
  // for "has worked in a professional setting".
  const internshipPoints = candidate.hasInternship ? 50 : 0;
  const projectPoints = Math.min(35, candidate.projectCount * 12);
  // Meeting the stated minimum experience contributes the remainder.
  const experiencePoints = job.experienceMinYears === 0 ? 15 : candidate.hasInternship ? 15 : 5;

  const score = internshipPoints + projectPoints + experiencePoints;

  const parts: string[] = [];
  if (candidate.hasInternship) parts.push('has internship experience');
  else parts.push('no internship on record');
  parts.push(`${candidate.projectCount} portfolio project${candidate.projectCount === 1 ? '' : 's'}`);

  return factor('Experience', score, FACTOR_WEIGHTS.experience, `${parts.join(', ')}.`);
}

function scoreLocation(input: CandidateMatchInput): Factor {
  const { candidate, job } = input;

  if (job.workMode === 'REMOTE') {
    return factor('Location', 100, FACTOR_WEIGHTS.location, 'This is a remote role, so location is not a constraint.');
  }

  if (!candidate.location || !job.location) {
    return factor('Location', 60, FACTOR_WEIGHTS.location, 'Location data is incomplete for one or both sides.');
  }

  const candidateCity = candidate.location.trim().toLowerCase();
  const jobCity = job.location.trim().toLowerCase();

  if (candidateCity === jobCity) {
    return factor('Location', 100, FACTOR_WEIGHTS.location, `Based in ${job.location}, matching the posting location.`);
  }
  // Same state or region is a reasonable partial match for relocation intent.
  if (candidateCity.includes(jobCity) || jobCity.includes(candidateCity)) {
    return factor('Location', 80, FACTOR_WEIGHTS.location, `Nearby location match (${candidate.location}).`);
  }

  return factor(
    'Location',
    45,
    FACTOR_WEIGHTS.location,
    `Candidate is in ${candidate.location} and the role is in ${job.location}; relocation would be required.`,
  );
}

function scoreInterests(input: CandidateMatchInput): Factor {
  const { candidate, job } = input;
  if (candidate.careerInterests.length === 0) {
    return factor('Career interest', 50, FACTOR_WEIGHTS.interest, 'The candidate has not stated career interests.');
  }

  const title = job.title.toLowerCase();
  const matches = candidate.careerInterests.filter((interest) => {
    const normalised = interest.trim().toLowerCase();
    return normalised.length > 2 && (title.includes(normalised) || normalised.includes(title));
  });

  if (matches.length > 0) {
    return factor(
      'Career interest',
      90,
      FACTOR_WEIGHTS.interest,
      `Role aligns with stated interest in ${matches.join(', ')}.`,
    );
  }

  return factor(
    'Career interest',
    55,
    FACTOR_WEIGHTS.interest,
    `Stated interests (${candidate.careerInterests.slice(0, 2).join(', ')}) do not mention this role type.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function scoreMatch(input: CandidateMatchInput): MatchResult {
  const eligibility = checkEligibility(input);
  if (eligibility.disqualified) {
    return {
      score: 0,
      factors: [
        factor('Eligibility', 0, 1, eligibility.reason ?? 'Does not meet the posting requirements.'),
      ],
      disqualified: true,
      disqualificationReason: eligibility.reason,
      strengths: [],
      gaps: [],
    };
  }

  const skills = scoreSkills(input);

  const factors: Factor[] = [
    skills.factor,
    scoreReadiness(input),
    scoreExperience(input),
    scoreLocation(input),
    scoreInterests(input),
  ];

  const score = factors.reduce((sum, f) => sum + (f.score * f.weight), 0);

  return {
    score: Math.round(score),
    factors,
    disqualified: false,
    strengths: skills.strengths,
    gaps: skills.gaps,
  };
}

export const ruleBasedJobMatching: JobMatchingService = {
  score: async (input) => scoreMatch(input),

  /**
   * Ranks a candidate set for one posting. Disqualified candidates are excluded
   * entirely rather than sorted to the bottom — an employer's shortlist should
   * not be padded with people who cannot be hired for the role.
   */
  rankCandidates: async (inputs, limit) => {
    return inputs
      .map((input) => ({ ...scoreMatch(input), jobId: input.job.id }))
      .filter((result) => !result.disqualified)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },
};

/**
 * Convenience for the candidate-facing side: ranks postings for one student.
 * The same factor model applies, which is what keeps the two views consistent —
 * a role that scores 90% for a student is one the employer also sees as a strong
 * match.
 */
export function rankJobsForCandidate(
  jobInputs: { job: CandidateMatchInput['job']; id: string; title: string }[],
  candidate: CandidateMatchInput['candidate'],
  limit = 20,
): { jobId: string; title: string; score: number; reasons: string[] }[] {
  return jobInputs
    .map(({ job, id, title }) => {
      const result = scoreMatch({ candidate, job });
      return {
        jobId: id,
        title,
        score: result.score,
        disqualified: result.disqualified,
        reasons: result.factors
          .filter((f) => f.weight > 0)
          .sort((a, b) => b.score * b.weight - a.score * a.weight)
          .slice(0, 3)
          .map((f) => f.reason),
      };
    })
    .filter((entry) => !entry.disqualified)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
