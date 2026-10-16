import type {
  LearningPathInput,
  LearningPathResult,
  LearningPathService,
  LearningStep,
} from './types.js';

/**
 * Personalised learning-path generation.
 *
 * Turns a skill-gap report into an ordered sequence of concrete actions. The
 * ordering rule that matters most: **skills are sequenced by dependency, not by
 * size of gap.**
 *
 * Students abandon plans that start with the hardest item. A roadmap that opens
 * with "learn SQL" and only later adds "apply it in Power BI" is far more likely
 * to be finished than one that opens with a data-modelling course. So the
 * generator places foundational, high-weight skills first and layers application
 * (courses → projects → assessment) on each.
 *
 * TODO(AI): an LLM can sequence across unusual role combinations (e.g. "product
 * marketing for a fintech") where a fixed dependency table does not apply. Keep
 * this generator as the fallback, which is also what runs when a student has no
 * target role set.
 */

/**
 * Prerequisite edges between common skill families.
 *
 * `{ before: 'SQL', after: 'Power BI' }` means SQL is scheduled first. Only
 * well-established dependencies are encoded — a wrong edge is worse than no edge,
 * because it forces an illogical order the student cannot override.
 */
const PREREQUISITES: { before: string; after: string }[] = [
  { before: 'excel', after: 'power bi' },
  { before: 'excel', after: 'tableau' },
  { before: 'excel', after: 'advanced excel' },
  { before: 'sql', after: 'power bi' },
  { before: 'sql', after: 'data analytics' },
  { before: 'sql', after: 'python' },
  { before: 'python', after: 'machine learning' },
  { before: 'python', after: 'data science' },
  { before: 'html', after: 'css' },
  { before: 'css', after: 'javascript' },
  { before: 'javascript', after: 'react' },
  { before: 'javascript', after: 'node.js' },
  { before: 'statistics', after: 'machine learning' },
  { before: 'communication', after: 'presentation skills' },
  { before: 'digital marketing', after: 'seo' },
  { before: 'digital marketing', after: 'social media marketing' },
  { before: 'accounting', after: 'financial modelling' },
];

/** Typical hours needed to move one proficiency level in a skill family. */
const HOURS_PER_LEVEL = 12;

/** A step should not be scheduled longer than this; longer work is split. */
const MAX_STEP_HOURS = 25;

function normalise(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Orders skills so that prerequisites come first, then by importance.
 *
 * A topological sort (Kahn's algorithm) over the prerequisite edges, with
 * importance breaking ties. Skills with no edges and no dependents fall through
 * in weight order.
 */
function topologicalOrder(skills: { name: string; weight: number }[]): string[] {
  const names = skills.map((s) => normalise(s.name));
  const weightByName = new Map(skills.map((s) => [normalise(s.name), s.weight]));

  const edges = PREREQUISITES.filter(
    (edge) => names.includes(normalise(edge.before)) && names.includes(normalise(edge.after)),
  );

  const inDegree = new Map<string, number>(names.map((n) => [n, 0]));
  const dependents = new Map<string, string[]>(names.map((n) => [n, []]));

  for (const edge of edges) {
    const before = normalise(edge.before);
    const after = normalise(edge.after);
    inDegree.set(after, (inDegree.get(after) ?? 0) + 1);
    dependents.get(before)?.push(after);
  }

  // Ready set, kept sorted by weight so the heaviest unblocked skill goes first.
  const ready = names
    .filter((n) => (inDegree.get(n) ?? 0) === 0)
    .sort((a, b) => (weightByName.get(b) ?? 0) - (weightByName.get(a) ?? 0));

  const ordered: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);

    for (const dependent of dependents.get(current) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        // Insert keeping the ready set weight-ordered.
        const insertAt = ready.findIndex(
          (candidate) => (weightByName.get(candidate) ?? 0) < (weightByName.get(dependent) ?? 0),
        );
        if (insertAt === -1) ready.push(dependent);
        else ready.splice(insertAt, 0, dependent);
      }
    }
  }

  // A cycle in the prerequisite table would drop skills; append anything missed
  // in plain weight order rather than silently losing it from the roadmap.
  const missing = names.filter((n) => !ordered.includes(n));
  missing.sort((a, b) => (weightByName.get(b) ?? 0) - (weightByName.get(a) ?? 0));

  return [...ordered, ...missing];
}

export function generateLearningPath(input: LearningPathInput): LearningPathResult {
  const { targetRole, currentSkills, requiredSkills, availableCourses, weeklyHoursAvailable } = input;

  const currentByName = new Map(currentSkills.map((s) => [normalise(s.name), s.score]));

  // --- Determine gaps -------------------------------------------------------
  const gapSkills = requiredSkills
    .map((required) => {
      const currentScore = currentByName.get(normalise(required.name)) ?? 0;
      const expectedScore =
        required.expectedLevel === 'EXPERT' ? 90
        : required.expectedLevel === 'ADVANCED' ? 75
        : required.expectedLevel === 'INTERMEDIATE' ? 50
        : 25;

      return {
        name: required.name,
        weight: required.weight,
        expectedLevel: required.expectedLevel,
        currentScore,
        expectedScore,
        deficit: Math.max(0, expectedScore - currentScore),
      };
    })
    .filter((skill) => skill.deficit > 8)
    .sort((a, b) => b.deficit * b.weight - a.deficit * a.weight);

  if (gapSkills.length === 0) {
    return {
      targetRole,
      steps: [
        {
          order: 1,
          title: `No skill gaps for ${targetRole}`,
          description:
            'You already meet the listed skill requirements. Focus on proving them: build a project that combines them, and apply to matched roles.',
          actionType: 'BUILD_PROJECT',
          targetId: availableProjects[0]?.id ?? null,
          estimatedHours: 20,
          addressesGap: 'Depth',
          rationale: 'Meeting every requirement makes demonstration, not acquisition, the next step.',
        },
        {
          order: 2,
          title: 'Apply to matched openings',
          description: 'Put your passport in front of employers — your profile is ready.',
          actionType: 'APPLY',
          targetId: null,
          estimatedHours: 3,
          addressesGap: 'Placement',
          rationale: 'Candidates who apply within a week of becoming ready convert at a much higher rate.',
        },
      ],
      totalEstimatedHours: 23,
      estimatedWeeks: Math.max(1, Math.ceil(23 / Math.max(1, weeklyHoursAvailable))),
      generatedBy: 'rule-based',
    };
  }

  // --- Order by dependency --------------------------------------------------
  const orderedNames = topologicalOrder(gapSkills.map((s) => ({ name: s.name, weight: s.weight * s.deficit })));
  const gapByName = new Map(gapSkills.map((s) => [normalise(s.name), s]));

  const steps: LearningStep[] = [];
  let order = 1;

  for (const name of orderedNames) {
    const gap = gapByName.get(name);
    if (!gap) continue;

    // Levels to climb, rounded up but never zero.
    const levelsToClimb = Math.max(1, Math.ceil(gap.deficit / 25));
    const estimatedHours = Math.min(MAX_STEP_HOURS, levelsToClimb * HOURS_PER_LEVEL);

    // Prefer a course that teaches this exact skill.
    const matchingCourse = availableCourses
      .filter((course) => course.skillNames.some((skill) => normalise(skill) === name))
      .sort((a, b) => {
        // Prefer free courses, then shorter ones — a student is more likely to
        // start a 3-hour free course than a 20-hour premium one.
        if (a.isPremium !== b.isPremium) return a.isPremium ? 1 : -1;
        return (a.durationMinutes ?? 9999) - (b.durationMinutes ?? 9999);
      })[0];

    const prerequisiteNames = PREREQUISITES.filter((edge) => normalise(edge.after) === name).map(
      (edge) => edge.before,
    );
    const satisfiedPrereqs = prerequisiteNames.filter(
      (prereq) => (currentByName.get(normalise(prereq)) ?? 0) >= 50,
    );

    if (matchingCourse) {
      steps.push({
        order: order++,
        title: `Complete "${matchingCourse.title}"`,
        description: `Covers ${gap.name} to ${gap.expectedLevel.toLowerCase()} level. ${
          matchingCourse.isPremium ? 'Premium course.' : 'Included free.'
        }`,
        actionType: 'COMPLETE_COURSE',
        targetId: matchingCourse.id,
        estimatedHours: matchingCourse.durationMinutes
          ? Math.max(2, Math.round(matchingCourse.durationMinutes / 60))
          : estimatedHours,
        addressesGap: gap.name,
        rationale:
          `You are at ${gap.currentScore}/100 on ${gap.name}; this role expects ${gap.expectedLevel.toLowerCase()} (${gap.expectedScore}/100).` +
          (satisfiedPrereqs.length > 0 ? ` You already have ${satisfiedPrereqs.join(', ')} to build on.` : ''),
      });
    } else {
      // No course available — schedule self-directed study instead of dropping
      // the gap from the plan entirely.
      steps.push({
        order: order++,
        title: `Build ${gap.name} to ${gap.expectedLevel.toLowerCase()} level`,
        description: `No course on the platform covers this yet. Work through structured self-study, then take the ${gap.name} assessment to confirm.`,
        actionType: 'TAKE_ASSESSMENT',
        targetId: null,
        estimatedHours,
        addressesGap: gap.name,
        rationale: `Gap of ${gap.deficit} points on ${gap.name}, weighted ${gap.weight.toFixed(2)} for ${targetRole}.`,
      });
    }

    // A project step for high-weight gaps: applying a skill in context is what
    // converts a course into something an employer can evaluate.
    if (gap.weight >= 0.6 && availableProjects.length > 0) {
      const project = availableProjects[0]!;
      steps.push({
        order: order++,
        title: `Apply ${gap.name} in a project`,
        description: `Use ${project.title} to demonstrate ${gap.name} end to end, then submit for mentor review.`,
        actionType: 'BUILD_PROJECT',
        targetId: project.id,
        estimatedHours: Math.max(8, project.difficulty * 6),
        addressesGap: gap.name,
        rationale: `A reviewed project is the strongest evidence of ${gap.name} — and it feeds the projects pillar of your readiness score.`,
      });
    }
  }

  const totalEstimatedHours = steps.reduce((sum, step) => sum + step.estimatedHours, 0);
  const weeklyHours = Math.max(1, weeklyHoursAvailable);

  return {
    targetRole,
    steps: steps.map((step, index) => ({ ...step, order: index + 1 })),
    totalEstimatedHours,
    estimatedWeeks: Math.max(1, Math.ceil(totalEstimatedHours / weeklyHours)),
    generatedBy: 'rule-based',
  };
}

export const ruleBasedLearningPath: LearningPathService = {
  generate: async (input) => generateLearningPath(input),
};
