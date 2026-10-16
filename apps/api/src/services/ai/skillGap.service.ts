import { PROFICIENCY_SCORE, type ProficiencyLevel } from '@campusconnect/shared';
import type { SkillGap, SkillGapInput, SkillGapResult, SkillGapService } from './types.js';

/**
 * Skill-gap analysis.
 *
 * Compares a student's current skill profile against what their target role
 * requires, and returns a ranked list of gaps. Rule-based: it is set arithmetic
 * over levels and weights, with no model involved.
 *
 * Why not just "missing skills": knowing a skill is absent is less useful than
 * knowing *how far short* the student is. A student at INTERMEDIATE who needs
 * ADVANCED has a very different problem from one who has never touched the skill,
 * so the gap is reported as a point deficit and paired with a level-appropriate
 * recommendation.
 *
 * TODO(AI): a model could infer required skills for a free-text target role and
 * weight gaps by how often they appear in real postings. Keep this as the
 * deterministic path and as the fallback when the model is unavailable.
 */

/** Numeric floor for "has no exposure at all". */
const NO_SKILL_SCORE = 0;

const LEVEL_SCORE: Record<ProficiencyLevel, number> = PROFICIENCY_SCORE;

/** A gap at or below this is not worth surfacing — it reads as noise. */
const NOISE_THRESHOLD = 8;

/** Level-appropriate next step for a given skill. */
function recommendationFor(
  skillName: string,
  currentLevel: ProficiencyLevel | 'NONE',
  expectedLevel: ProficiencyLevel,
): string {
  if (currentLevel === 'NONE') {
    return `Start with a beginner course on ${skillName}, then take the ${skillName} assessment to confirm the baseline.`;
  }

  const delta = LEVEL_SCORE[expectedLevel] - LEVEL_SCORE[currentLevel];

  if (delta <= 10) {
    return `You are close. One focused project using ${skillName} in context will take you to ${expectedLevel.toLowerCase()} level.`;
  }
  if (delta <= 30) {
    return `Take an intermediate ${skillName} course and build one project that applies it. Re-assess afterwards.`;
  }
  return `You are ${delta} points below what ${expectedLevel.toLowerCase()} level requires. Work through a structured ${skillName} path before applying to roles that list it as required.`;
}

/** Human-readable summary line for the top of the gap report. */
function summarise(
  matchPercentage: number,
  gaps: SkillGap[],
  targetRole: string,
  hasRequired: boolean,
): string {
  if (!hasRequired) {
    return `There is no required-skill definition for ${targetRole} yet, so this report only reflects the skills you have recorded.`;
  }
  if (gaps.length === 0) {
    return `You cover every skill listed for ${targetRole}. Focus on depth and on a portfolio project that demonstrates them together.`;
  }

  const critical = gaps.filter((g) => g.importance >= 0.7).length;
  const headline = `You match ${matchPercentage}% of the skill profile for ${targetRole}.`;

  if (critical >= 3) {
    return `${headline} ${critical} of the gaps are high-priority for this role — start with ${gaps[0]!.skillName}.`;
  }
  return `${headline} The clearest next step is ${gaps[0]!.skillName} (${gaps[0]!.gap} points short).`;
}

export function analyseSkillGap(input: SkillGapInput): SkillGapResult {
  const { currentSkills, requiredSkills, targetRole } = input;

  // Index current skills by name for O(1) lookup. Names are compared
  // case-insensitively and trimmed so "Power BI" matches "power bi".
  const currentByName = new Map(
    currentSkills.map((skill) => [skill.name.trim().toLowerCase(), skill]),
  );

  const gaps: SkillGap[] = [];
  const strengths: SkillGapResult['strengths'] = [];

  let weightedCoverage = 0;
  let totalWeight = 0;

  for (const required of requiredSkills) {
    const key = required.name.trim().toLowerCase();
    const current = currentByName.get(key);
    const expectedScore = LEVEL_SCORE[required.expectedLevel];
    const currentScore = current?.score ?? NO_SKILL_SCORE;

    totalWeight += required.weight;

    if (currentScore >= expectedScore) {
      // Meeting or exceeding the requirement contributes full coverage, capped at
      // 1 so an over-qualified skill cannot mask a genuine gap elsewhere.
      weightedCoverage += required.weight;
      strengths.push({
        name: required.name,
        score: Math.round(currentScore),
        categoryName: current?.categoryName ?? required.categoryName,
      });
      continue;
    }

    // Partial credit: a skill half-way to the required level covers half its
    // weight. Without this, a student one point short looks identical to one who
    // has never heard of the skill.
    const coverage = expectedScore > 0 ? Math.min(1, currentScore / expectedScore) : 0;
    weightedCoverage += required.weight * coverage;

    const gap = expectedScore - currentScore;
    if (gap <= NOISE_THRESHOLD) continue;

    gaps.push({
      skillName: required.name,
      categoryName: current?.categoryName ?? required.categoryName,
      currentLevel: current?.proficiency ?? 'NONE',
      currentScore: Math.round(currentScore),
      expectedLevel: required.expectedLevel,
      gap: Math.round(gap),
      importance: required.weight,
      recommendation: recommendationFor(required.name, current?.proficiency ?? 'NONE', required.expectedLevel),
    });
  }

  const matchPercentage = totalWeight > 0 ? Math.round((weightedCoverage / totalWeight) * 100) : 0;

  // Rank by what actually matters: a high-importance gap with a large deficit
  // outranks a low-importance one that is nearly closed.
  gaps.sort((a, b) => b.importance * b.gap - a.importance * a.gap);

  // Strengths are useful for interview prep and for the passport, so keep the
  // strongest few even when the student is broadly behind.
  strengths.sort((a, b) => b.score - a.score);

  return {
    targetRole,
    matchPercentage,
    gaps,
    strengths: strengths.slice(0, 8),
    summary: summarise(matchPercentage, gaps, targetRole, requiredSkills.length > 0),
  };
}

export const ruleBasedSkillGap: SkillGapService = {
  analyse: async (input) => analyseSkillGap(input),
};
