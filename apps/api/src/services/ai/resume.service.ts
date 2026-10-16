import type {
  ResumeQualityInput,
  ResumeQualityResult,
  ResumeSuggestion,
  ResumeSuggestionService,
} from './types.js';

/**
 * Resume review.
 *
 * Rule-based scoring against the things that demonstrably matter to recruiters
 * and to applicant-tracking systems: quantified achievements, strong action
 * verbs, concrete technologies, contact links, and enough substance in each
 * section to survive a six-second skim.
 *
 * The score is a diagnostic, not a verdict. Each deduction comes with a specific
 * fix and, where possible, a rewrite example — "add metrics" is advice a student
 * cannot act on; "instead of 'worked on the sales dashboard', write 'built a
 * Power BI dashboard tracking 14 regional KPIs, cutting weekly reporting time by
 * 60%'" is advice they can.
 *
 * TODO(AI): an LLM can generate the rewritten bullets rather than describing them.
 * Keep this rule engine as both the fallback and the scorer — a model should not
 * be the thing that decides whether a resume is good.
 */

/** Verbs that signal ownership. Bullets opening with these read as contributions. */
const STRONG_VERBS = new Set([
  'built', 'designed', 'developed', 'led', 'launched', 'created', 'implemented',
  'improved', 'increased', 'reduced', 'analysed', 'analyzed', 'automated', 'delivered',
  'managed', 'coordinated', 'organised', 'organized', 'researched', 'modelled', 'modeled',
  'optimised', 'optimized', 'streamlined', 'negotiated', 'presented', 'founded',
  'initiated', 'spearheaded', 'engineered', 'migrated', 'scaled', 'trained', 'mentored',
]);

/** Weak openers that dilute a bullet. */
const WEAK_OPENERS = [
  'responsible for', 'worked on', 'helped with', 'involved in', 'assisted in',
  'participated in', 'was part of', 'duties included', 'tasked with', 'handled',
];

/** Filler that recruiters skip past. */
const FILLER_PHRASES = [
  'team player', 'hard working', 'hardworking', 'go-getter', 'self-starter',
  'think outside the box', 'results-driven', 'dynamic professional', 'excellent communication skills',
  'quick learner', 'passionate about', 'detail-oriented', 'detail oriented',
];

const TIME_TO_FIX_POINTS: Record<ResumeSuggestion['severity'], number> = {
  CRITICAL: 12,
  IMPORTANT: 6,
  NICE_TO_HAVE: 2,
};

function suggestion(
  id: string,
  section: ResumeSuggestion['section'],
  severity: ResumeSuggestion['severity'],
  title: string,
  detail: string,
  impact: number,
  example?: ResumeSuggestion['example'],
): ResumeSuggestion {
  return { id, section, severity, title, detail, impact, ...(example ? { example } : {}) };
}

export function reviewResume(input: ResumeQualityInput): ResumeQualityResult {
  const suggestions: ResumeSuggestion[] = [];

  /* --- Summary ------------------------------------------------------------ */
  const summaryScore = (() => {
    if (!input.hasSummary) {
      suggestions.push(
        suggestion(
          'summary-missing',
          'SUMMARY',
          'IMPORTANT',
          'Add a two-line summary',
          'A summary is the first thing a recruiter reads. State what you do, your strongest skill, and what role you are targeting.',
          8,
          {
            before: '(no summary)',
            after:
              'BBA final-year student focused on business analytics. Power BI and advanced Excel, with a reviewed capstone on retail demand forecasting. Seeking a data analyst internship.',
          },
        ),
      );
      return 0;
    }
    if (input.summaryWordCount < 15) {
      suggestions.push(
        suggestion(
          'summary-thin',
          'SUMMARY',
          'IMPORTANT',
          'Expand your summary',
          `It is ${input.summaryWordCount} words. Aim for 25–45 words: role, strongest skill, and one concrete proof point.`,
          5,
        ),
      );
      return 55;
    }
    if (input.summaryWordCount > 90) {
      suggestions.push(
        suggestion(
          'summary-long',
          'SUMMARY',
          'NICE_TO_HAVE',
          'Shorten your summary',
          `${input.summaryWordCount} words is long enough that recruiters will skim past it. Cut to 45 words or fewer.`,
          3,
        ),
      );
      return 80;
    }
    return 100;
  })();

  /* --- Experience --------------------------------------------------------- */
  const experienceScore = (() => {
    if (input.experienceCount === 0) {
      suggestions.push(
        suggestion(
          'experience-missing',
          'EXPERIENCE',
          'IMPORTANT',
          'Add internships, part-time work or campus roles',
          'Unpaid and campus work counts. List internships, freelance projects, club committee roles and volunteering — anything with responsibility and an outcome.',
          10,
        ),
      );
      return 20;
    }
    if (input.experienceCount < 2) {
      suggestions.push(
        suggestion(
          'experience-thin',
          'EXPERIENCE',
          'NICE_TO_HAVE',
          'Add one more experience entry',
          'Two or more entries make a pattern. A short internship, a freelance engagement or a club leadership role all work.',
          5,
        ),
      );
      return 70;
    }
    return 100;
  })();

  /* --- Quantification ----------------------------------------------------- */
  const quantificationScore = (() => {
    if (input.totalBulletCount === 0) return 50;

    const ratio = input.quantifiedBulletCount / input.totalBulletCount;

    if (ratio >= 0.5) return 100;
    if (ratio >= 0.3) {
      suggestions.push(
        suggestion(
          'more-metrics',
          'EXPERIENCE',
          'IMPORTANT',
          'Add numbers to more bullets',
          `Only ${input.quantifiedBulletCount} of ${input.totalBulletCount} bullets contain a number. Target at least half — scale, percentage, time saved, budget, or number of users.`,
          7,
          {
            before: 'Improved the club social media presence.',
            after: 'Grew the club Instagram from 400 to 2,300 followers in one semester, tripling event sign-ups.',
          },
        ),
      );
      return 60 + ratio * 60;
    }

    suggestions.push(
      suggestion(
        'quantify-bullets',
        'EXPERIENCE',
        'CRITICAL',
        'Quantify your impact',
        `Only ${input.quantifiedBulletCount} of ${input.totalBulletCount} bullets have a measurable result. Recruiters rank quantified achievements far above descriptions of duties.`,
        12,
        {
          before: 'Responsible for managing the inventory spreadsheet.',
          after:
            'Rebuilt the inventory tracker in Excel, cutting stock-count time from 3 hours to 40 minutes per week.',
        },
      ),
    );
    return 30;
  })();

  /* --- Weak verbs --------------------------------------------------------- */
  const verbScore = (() => {
    if (input.weakVerbCount === 0) return 100;
    const severity: ResumeSuggestion['severity'] = input.weakVerbCount >= 3 ? 'CRITICAL' : 'IMPORTANT';
    suggestions.push(
      suggestion(
        'weak-verbs',
        'EXPERIENCE',
        severity,
        'Replace passive phrases with action verbs',
        `${input.weakVerbCount} bullet${input.weakVerbCount === 1 ? '' : 's'} open with phrases like "responsible for" or "worked on". Lead with what you did.`,
        Math.min(12, input.weakVerbCount * 2),
        {
          before: 'Responsible for coordinating the annual fest.',
          after: 'Coordinated a 3-day college fest with 42 volunteers and 1,800 attendees across 11 events.',
        },
      ),
    );
    return Math.max(35, 100 - input.weakVerbCount * 12);
  })();

  /* --- Projects ----------------------------------------------------------- */
  const projectScore = (() => {
    if (input.projectCount === 0) {
      suggestions.push(
        suggestion(
          'projects-missing',
          'PROJECTS',
          'IMPORTANT',
          'Add a project section',
          'Two reviewed projects give a recruiter something concrete to discuss. Course capstones and self-built work both qualify.',
          10,
        ),
      );
      return 40;
    }
    if (input.projectCount < 2) {
      suggestions.push(
        suggestion(
          'projects-thin',
          'PROJECTS',
          'NICE_TO_HAVE',
          'Add a second project',
          'A single project reads as a one-off. Two show a pattern of building.',
          5,
        ),
      );
      return 70;
    }
    return 100;
  })();

  /* --- Skills ------------------------------------------------------------- */
  const skillScore = (() => {
    if (input.skillCount === 0) {
      suggestions.push(
        suggestion(
          'skills-missing',
          'SKILLS',
          'CRITICAL',
          'List your skills',
          'This section is what keyword-matching systems read first. List 8–14 skills, ordered by strength.',
          12,
        ),
      );
      return 0;
    }
    if (input.skillCount < 6) {
      suggestions.push(
        suggestion(
          'skills-few',
          'SKILLS',
          'IMPORTANT',
          'List more skills',
          `You list ${input.skillCount}. Aim for 8–14, covering tools, domains and soft skills. Do not pad with skills you cannot defend in an interview.`,
          6,
        ),
      );
      return 60;
    }
    if (input.skillCount > 20) {
      suggestions.push(
        suggestion(
          'skills-many',
          'SKILLS',
          'NICE_TO_HAVE',
          'Trim your skills list',
          `${input.skillCount} skills dilutes the section and invites a question you cannot answer. Keep 10–14 of your strongest.`,
          3,
        ),
      );
      return 85;
    }
    return 100;
  })();

  /* --- Links -------------------------------------------------------------- */
  const linkScore = (() => {
    const missing: string[] = [];
    if (!input.hasLinkedin) missing.push('LinkedIn');
    if (!input.hasGithub) missing.push('GitHub');
    if (!input.hasPortfolio) missing.push('portfolio');

    if (missing.length === 3) {
      suggestions.push(
        suggestion(
          'links-missing',
          'LINKS',
          'IMPORTANT',
          'Add your LinkedIn profile',
          'A LinkedIn URL is expected on every application in India. GitHub and a portfolio help for technical and design roles.',
          6,
        ),
      );
      return 30;
    }
    if (input.hasLinkedin && (input.hasGithub || input.hasPortfolio)) return 100;
    if (input.hasLinkedin) return 80;

    suggestions.push(
      suggestion(
        'linkedin-missing',
        'LINKS',
        'IMPORTANT',
        'Add your LinkedIn profile',
        'Most recruiters check LinkedIn before an interview. Include the full URL in the contact line.',
        5,
      ),
    );
    return 50;
  })();

  /* --- Certifications ----------------------------------------------------- */
  const certificateScore = (() => {
    if (input.certificateCount === 0) {
      suggestions.push(
        suggestion(
          'certs-missing',
          'EDUCATION',
          'NICE_TO_HAVE',
          'Add verified certificates',
          'Certificates issued through CampusConnect carry a verification link, which recruiters can check in one click.',
          4,
        ),
      );
      return 40;
    }
    return Math.min(100, 60 + input.certificateCount * 10);
  })();

  /* --- Filler ------------------------------------------------------------- */
  const lowerText = input.rawText.toLowerCase();
  const fillerFound = FILLER_PHRASES.filter((phrase) => lowerText.includes(phrase));
  if (fillerFound.length > 0) {
    suggestions.push(
      suggestion(
        'filler-language',
        'FORMATTING',
        'NICE_TO_HAVE',
        'Remove generic filler phrases',
        `Found: ${fillerFound.map((f) => `"${f}"`).join(', ')}. Replace each with evidence — a number, a technology or an outcome.`,
        3,
      ),
    );
  }

  /* --- Aggregate ---------------------------------------------------------- */
  /**
   * Section scores are weighted rather than averaged. Experience and
   * quantification move the needle for a recruiter; the summary is read first but
   * is short.
   */
  const sectionScores: Record<string, number> = {
    summary: Math.round(summaryScore),
    experience: Math.round(experienceScore),
    quantification: Math.round(quantificationScore),
    actionVerbs: Math.round(verbScore),
    projects: Math.round(projectScore),
    skills: Math.round(skillScore),
    links: Math.round(linkScore),
    certifications: Math.round(certificateScore),
  };

  const weights: Record<keyof typeof sectionScores, number> = {
    summary: 0.08,
    experience: 0.2,
    quantification: 0.22,
    actionVerbs: 0.1,
    projects: 0.16,
    skills: 0.12,
    links: 0.07,
    certifications: 0.05,
  };

  const score = Math.round(
    Object.entries(weights).reduce((sum, [key, weight]) => sum + sectionScores[key]! * weight, 0),
  );

  // Order by impact so the sidebar shows the highest-value fix first.
  const severityRank = { CRITICAL: 0, IMPORTANT: 1, NICE_TO_HAVE: 2 } as const;
  suggestions.sort((a, b) => b.impact - a.impact || severityRank[a.severity] - severityRank[b.severity]);

  const band =
    score >= 85 ? 'Recruiter Ready'
    : score >= 70 ? 'Strong'
    : score >= 55 ? 'Needs Work'
    : score >= 35 ? 'Weak'
    : 'Incomplete';

  return { score, band, suggestions, sectionScores };
}

/** Extracts the counts `reviewResume` needs from raw resume text. */
export function analyseResumeText(text: string): {
  weakVerbCount: number;
  quantifiedBulletCount: number;
  totalBulletCount: number;
} {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  /**
   * A "bullet" is a line that looks like an achievement: it starts with a bullet
   * character or a capitalised verb, and is long enough to be a sentence rather
   * than a heading. This heuristic is intentionally conservative — over-counting
   * bullets inflates the score by making the ratio look better than it is.
   */
  const bullets = lines.filter((line) => {
    const stripped = line.replace(/^[-•*·▪‣]\s*/, '');
    if (stripped.length < 40) return false;
    const firstWord = stripped.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
    return (
      /^[-•*·▪‣]/.test(line) ||
      STRONG_VERBS.has(firstWord) ||
      WEAK_OPENERS.some((opener) => stripped.toLowerCase().startsWith(opener))
    );
  });

  const weakVerbCount = bullets.filter((line) =>
    WEAK_OPENERS.some((opener) => line.replace(/^[-•*·▪‣]\s*/, '').toLowerCase().startsWith(opener)),
  ).length;

  // Numbers include percentages, currency and plain counts.
  const quantifiedBulletCount = bullets.filter((line) => /\d/.test(line)).length;

  return { weakVerbCount, quantifiedBulletCount, totalBulletCount: bullets.length };
}

export const ruleBasedResumeReview: ResumeSuggestionService = {
  review: async (input) => reviewResume(input),
};
