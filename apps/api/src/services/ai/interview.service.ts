import type {
  AnswerEvaluation,
  AnswerEvaluationInput,
  InterviewQuestion,
  InterviewQuestionInput,
  InterviewService,
} from './types.js';

/**
 * Mock-interview question bank and answer scoring.
 *
 * Two independent capabilities, both rule-based:
 *
 *  - **Question generation** for practice mode. Draws from a curated bank by role
 *    family, so a student practising for a data analyst role gets SQL and
 *    stakeholder questions rather than generic ones.
 *  - **Answer evaluation** for self-practice. Structural analysis of the text: a
 *    STAR-shaped answer with concrete detail scores well; a one-line answer does
 *    not, regardless of how correct it is.
 *
 * Honest limitation: text analysis cannot assess whether an answer is *true* or
 * *technically correct*. It measures structure, specificity and completeness.
 * The UI must present the score as coaching on how the answer lands, not as a
 * correctness verdict — otherwise a student gets false confidence in a wrong
 * answer.
 *
 * TODO(AI): an LLM can assess technical correctness and generate follow-ups. The
 * text heuristics here stay as the offline fallback.
 */

/* -------------------------------------------------------------------------- */
/* Question bank                                                              */
/* -------------------------------------------------------------------------- */

type BankQuestion = {
  id: string;
  kind: InterviewQuestion['kind'];
  difficulty: number;
  text: string;
  evaluationHints: string[];
  suggestedSeconds: number;
};

/** Role families matched against the target role string. */
const ROLE_FAMILIES: { keywords: string[]; family: string }[] = [
  { keywords: ['data analyst', 'business analyst', 'analytics', 'bi ', 'business intelligence'], family: 'analytics' },
  { keywords: ['software', 'developer', 'engineer', 'sde', 'frontend', 'backend', 'full stack'], family: 'engineering' },
  { keywords: ['marketing', 'digital marketing', 'seo', 'brand', 'content'], family: 'marketing' },
  { keywords: ['finance', 'accounting', 'financial', 'audit', 'investment'], family: 'finance' },
  { keywords: ['hr', 'human resource', 'recruit', 'talent'], family: 'hr' },
  { keywords: ['sales', 'business development'], family: 'sales' },
  { keywords: ['product', 'product manager'], family: 'product' },
  { keywords: ['design', 'ux', 'ui'], family: 'design' },
];

const COMMON_QUESTIONS: BankQuestion[] = [
  {
    id: 'common-tell-me-about-yourself',
    kind: 'BEHAVIOURAL',
    difficulty: 1,
    text: 'Tell me about yourself.',
    evaluationHints: [
      'Present-focused: what you are doing now and what you are targeting',
      'One or two concrete proof points, not a life history',
      'Ends by connecting to the role being interviewed for',
      'Around 90 seconds — long enough to be substantive, short enough to hold attention',
    ],
    suggestedSeconds: 90,
  },
  {
    id: 'common-why-this-role',
    kind: 'BEHAVIOURAL',
    difficulty: 1,
    text: 'Why do you want this role, and why our company?',
    evaluationHints: [
      'Names something specific about the company, not just its reputation',
      'Connects the role to a demonstrated interest, not a generic ambition',
      'Avoids answering only "I want to learn" — the employer is hiring for output',
    ],
    suggestedSeconds: 90,
  },
  {
    id: 'common-strength-weakness',
    kind: 'BEHAVIOURAL',
    difficulty: 2,
    text: 'What is your greatest strength, and what is one area you are actively working to improve?',
    evaluationHints: [
      'Strength is evidenced with a specific example, not an adjective',
      'Weakness is real and is paired with what the candidate is doing about it',
      'Avoids the disguised strength ("I am a perfectionist")',
    ],
    suggestedSeconds: 105,
  },
  {
    id: 'common-conflict',
    kind: 'BEHAVIOURAL',
    difficulty: 2,
    text: 'Describe a time you disagreed with a teammate or a supervisor. How did you handle it?',
    evaluationHints: [
      'STAR structure: situation, task, action, result',
      'Shows the candidate listening rather than just winning the argument',
      'Ends with what they learned or what changed',
    ],
    suggestedSeconds: 150,
  },
  {
    id: 'common-failure',
    kind: 'BEHAVIOURAL',
    difficulty: 3,
    text: 'Tell me about a project that did not go as planned. What went wrong, and what did you do differently next time?',
    evaluationHints: [
      'Owns the failure rather than blaming circumstances or other people',
      'Quantifies the impact of the failure',
      'Shows a concrete change in behaviour afterwards',
    ],
    suggestedSeconds: 150,
  },
  {
    id: 'common-pressure',
    kind: 'SITUATIONAL',
    difficulty: 2,
    text: 'You have three tasks due this week and your manager adds a fourth urgent one. How do you handle it?',
    evaluationHints: [
      'Triages explicitly rather than saying they would do everything',
      'Communicates early with the manager instead of silently failing',
      'Names a concrete prioritisation criterion (deadline, impact, dependency)',
    ],
    suggestedSeconds: 120,
  },
  {
    id: 'common-ambiguity',
    kind: 'SITUATIONAL',
    difficulty: 3,
    text: 'You are given a task with unclear requirements and no one is available to explain. What do you do?',
    evaluationHints: [
      'Asks clarifying questions in writing rather than guessing silently',
      'States a documented assumption and proceeds on a reasonable default',
      'Sets a checkpoint to validate the assumption',
    ],
    suggestedSeconds: 120,
  },
];

const FAMILY_QUESTIONS: Record<string, BankQuestion[]> = {
  analytics: [
    {
      id: 'analytics-sql-join',
      kind: 'TECHNICAL',
      difficulty: 2,
      text: 'Explain the difference between an INNER JOIN and a LEFT JOIN, and when you would choose each.',
      evaluationHints: [
        'Correct: INNER keeps only matching rows, LEFT keeps all left-hand rows',
        'Gives a business scenario, not just the definition',
        'Mentions the NULL behaviour of unmatched LEFT JOIN rows',
      ],
      suggestedSeconds: 120,
    },
    {
      id: 'analytics-vlookup-powerquery',
      kind: 'TECHNICAL',
      difficulty: 2,
      text: 'How would you combine data from three different Excel sheets into one report that refreshes weekly?',
      evaluationHints: [
        'Mentions Power Query or a repeatable transform rather than manual copy-paste',
        'Considers what happens when the structure of a source sheet changes',
        'Addresses how the refresh is triggered and checked',
      ],
      suggestedSeconds: 150,
    },
    {
      id: 'analytics-dashboard-stakeholder',
      kind: 'ROLE_SPECIFIC',
      difficulty: 3,
      text: 'A stakeholder asks for a dashboard with 30 metrics. How do you respond?',
      evaluationHints: [
        'Asks what decision the dashboard will drive, rather than building it as asked',
        'Proposes a small core set of metrics with drill-downs',
        'Shows willingness to push back constructively',
      ],
      suggestedSeconds: 150,
    },
    {
      id: 'analytics-data-quality',
      kind: 'TECHNICAL',
      difficulty: 3,
      text: 'You find that a report has been overstating monthly sales by 8%. Walk me through what you do next.',
      evaluationHints: [
        'Immediately quantifies and communicates the impact to affected consumers',
        'Traces the root cause in the pipeline rather than patching the report',
        'Adds a check so the same error cannot recur silently',
      ],
      suggestedSeconds: 180,
    },
    {
      id: 'analytics-explain-metric',
      kind: 'ROLE_SPECIFIC',
      difficulty: 2,
      text: 'Explain a technical analysis you did to someone with no data background.',
      evaluationHints: [
        'Avoids jargon or defines it immediately',
        'Leads with the business finding, not the method',
        'Uses an analogy or a concrete number to anchor the explanation',
      ],
      suggestedSeconds: 120,
    },
  ],

  engineering: [
    {
      id: 'eng-explain-project',
      kind: 'TECHNICAL',
      difficulty: 2,
      text: 'Walk me through the most technically complex thing you have built. What decisions did you make and why?',
      evaluationHints: [
        'Explains the problem before the solution',
        'Justifies at least one trade-off explicitly',
        'Can describe what they would do differently now',
      ],
      suggestedSeconds: 180,
    },
    {
      id: 'eng-debug',
      kind: 'SITUATIONAL',
      difficulty: 3,
      text: 'A feature works on your machine but fails in production for some users. How do you debug it?',
      evaluationHints: [
        'Forms hypotheses and tests them rather than changing things at random',
        'Mentions logs, reproduction, and narrowing the affected population',
        'Considers environment, data and timing differences',
      ],
      suggestedSeconds: 180,
    },
    {
      id: 'eng-code-review',
      kind: 'BEHAVIOURAL',
      difficulty: 2,
      text: 'Tell me about a time you received critical feedback on your work. How did you respond?',
      evaluationHints: [
        'Does not get defensive or dismiss the feedback',
        'Describes a specific change made as a result',
        'Shows they separated the criticism of the work from themselves',
      ],
      suggestedSeconds: 150,
    },
    {
      id: 'eng-testing',
      kind: 'TECHNICAL',
      difficulty: 3,
      text: 'How do you decide what to test, and what does a good test look like to you?',
      evaluationHints: [
        'Prioritises by risk and change frequency rather than aiming for coverage percentage',
        'Distinguishes unit from integration testing and knows when each applies',
        'Mentions tests that would fail for the right reason',
      ],
      suggestedSeconds: 150,
    },
  ],

  marketing: [
    {
      id: 'mkt-campaign',
      kind: 'ROLE_SPECIFIC',
      difficulty: 2,
      text: 'You have ₹50,000 to promote a college fest. How would you spend it?',
      evaluationHints: [
        'Sets a target metric before choosing channels',
        'Justifies channel mix against the target audience',
        'Describes how success would be measured',
      ],
      suggestedSeconds: 180,
    },
    {
      id: 'mkt-metrics',
      kind: 'TECHNICAL',
      difficulty: 2,
      text: 'Explain the difference between reach, engagement and conversion, and which you would optimise for.',
      evaluationHints: [
        'Defines each correctly and distinguishes them',
        'Ties the choice to a business objective rather than picking one universally',
        'Mentions that optimising one can hurt another',
      ],
      suggestedSeconds: 120,
    },
    {
      id: 'mkt-low-performance',
      kind: 'SITUATIONAL',
      difficulty: 3,
      text: 'A campaign you launched is underperforming halfway through. What do you do?',
      evaluationHints: [
        'Diagnoses before acting — audience, creative, timing, placement',
        'Describes a specific change and a re-measurement window',
        'Knows when to stop spending rather than doubling down',
      ],
      suggestedSeconds: 150,
    },
  ],

  finance: [
    {
      id: 'fin-three-statements',
      kind: 'TECHNICAL',
      difficulty: 3,
      text: 'How do the three financial statements connect to each other?',
      evaluationHints: [
        'Correct linkage through net income, cash flow and retained earnings',
        'Uses a concrete transaction to illustrate',
        'Notes that this is how errors are traced in practice',
      ],
      suggestedSeconds: 180,
    },
    {
      id: 'fin-excel-model',
      kind: 'TECHNICAL',
      difficulty: 2,
      text: 'Describe how you would build a monthly budget tracker from scratch in Excel.',
      evaluationHints: [
        'Separates inputs from calculations from outputs',
        'Mentions data validation and version control',
        'Considers how someone else would maintain it',
      ],
      suggestedSeconds: 150,
    },
  ],

  hr: [
    {
      id: 'hr-screening',
      kind: 'ROLE_SPECIFIC',
      difficulty: 2,
      text: 'You have 200 applications for one role and two days. How do you shortlist?',
      evaluationHints: [
        'Defines screening criteria from the role requirements before looking at any CV',
        'Describes a two-pass approach — fast filter, then careful read',
        'Considers how to avoid missing non-obvious strong candidates',
      ],
      suggestedSeconds: 150,
    },
    {
      id: 'hr-difficult-conversation',
      kind: 'SITUATIONAL',
      difficulty: 3,
      text: 'An employee you manage is consistently late with deliverables. How do you address it?',
      evaluationHints: [
        'Addresses it directly and early rather than waiting for a review cycle',
        'Seeks the cause before assuming a performance problem',
        'Agrees a specific, checkable improvement plan with a date',
      ],
      suggestedSeconds: 150,
    },
  ],

  sales: [
    {
      id: 'sales-cold-call',
      kind: 'ROLE_SPECIFIC',
      difficulty: 2,
      text: 'You have 30 seconds on a cold call to a busy decision maker. What do you say?',
      evaluationHints: [
        'Leads with a relevance hook, not a product description',
        'Asks for a small commitment rather than a sale',
        'Is specific about the problem they solve',
      ],
      suggestedSeconds: 90,
    },
    {
      id: 'sales-objection',
      kind: 'SITUATIONAL',
      difficulty: 3,
      text: 'A prospect says your solution is too expensive. How do you respond?',
      evaluationHints: [
        'Asks what they are comparing against rather than defending the price',
        'Reframes around cost of the problem, not features',
        'Is comfortable walking away when it is genuinely not a fit',
      ],
      suggestedSeconds: 120,
    },
  ],

  product: [
    {
      id: 'prod-prioritise',
      kind: 'ROLE_SPECIFIC',
      difficulty: 3,
      text: 'You have ten feature requests and capacity for two. How do you decide?',
      evaluationHints: [
        'Names an explicit framework or criterion rather than intuition',
        'Weighs impact against effort and strategic fit',
        'Explains how the decision would be communicated to those not chosen',
      ],
      suggestedSeconds: 180,
    },
  ],

  design: [
    {
      id: 'design-critique',
      kind: 'TECHNICAL',
      difficulty: 2,
      text: 'Walk me through a design decision you made and the reasoning behind it.',
      evaluationHints: [
        'Connects the decision to a user need, not personal preference',
        'Mentions alternatives considered and rejected',
        'References evidence — testing, feedback, or data',
      ],
      suggestedSeconds: 180,
    },
  ],
};

export function detectRoleFamily(role: string): string {
  const normalised = ` ${role.toLowerCase().trim()} `;
  const match = ROLE_FAMILIES.find((family) =>
    family.keywords.some((keyword) => normalised.includes(keyword)),
  );
  return match?.family ?? 'general';
}

/**
 * Draws a question set for a practice session.
 *
 * Every session includes common behavioural questions — those are asked in
 * essentially every interview regardless of role — then fills the remainder from
 * the role family. Difficulty is spread across the range so a session is not all
 * warm-up or all pressure.
 */
export function generateQuestions(input: InterviewQuestionInput): InterviewQuestion[] {
  const { role, count, excludeIds = [], difficulty } = input;
  const family = detectRoleFamily(role);

  const pool: BankQuestion[] = [
    ...COMMON_QUESTIONS,
    ...(FAMILY_QUESTIONS[family] ?? []),
  ].filter((question) => !excludeIds.includes(question.id));

  const filtered =
    difficulty !== undefined
      ? // Allow one level either side so a session has variety around the target.
        pool.filter((q) => Math.abs(q.difficulty - difficulty) <= 1)
      : pool;

  const candidates = filtered.length >= count ? filtered : pool;

  // Guarantee behavioural coverage first, then fill by role relevance.
  const behavioural = candidates.filter((q) => q.kind === 'BEHAVIOURAL');
  const rest = candidates.filter((q) => q.kind !== 'BEHAVIOURAL');

  const selected: BankQuestion[] = [
    ...behavioural.slice(0, Math.max(1, Math.ceil(count / 3))),
    ...rest,
  ].slice(0, count);

  // If the bank is smaller than the request, cycle deterministically rather than
  // returning fewer questions than asked for.
  while (selected.length < count && candidates.length > 0) {
    selected.push(candidates[selected.length % candidates.length]!);
  }

  return selected.map((question) => ({
    id: question.id,
    text: question.text,
    kind: question.kind,
    difficulty: question.difficulty,
    evaluationHints: question.evaluationHints,
    suggestedSeconds: question.suggestedSeconds,
  }));
}

/* -------------------------------------------------------------------------- */
/* Answer evaluation                                                          */
/* -------------------------------------------------------------------------- */

/** Words that signal a structured answer. */
const STRUCTURE_MARKERS = [
  'first', 'second', 'third', 'then', 'next', 'finally', 'because', 'so that',
  'as a result', 'the result was', 'i decided', 'i learned', 'the outcome',
  'for example', 'in that case', 'at the time', 'my role was', 'we agreed',
];

/** Concrete detail markers — numbers, named tools, named entities. */
const SPECIFICITY_PATTERNS = [
  /\d+%/,                    // percentages
  /\d{2,}/,                  // multi-digit numbers
  /₹\s?\d+|\$\s?\d+|\d+\s?(rupees|lakh|crore|k\b)/i,
  /\b(excel|sql|python|power bi|tableau|figma|jira|salesforce|hubspot|canva)\b/i,
  /\b(monday|week|month|quarter|semester|year)\b/i,
];

/** Disfluency and hedging that weaken an otherwise good answer. */
const HEDGING_PHRASES = [
  'i think maybe', 'kind of', 'sort of', 'i guess', 'probably', 'not really sure',
  'i am not sure', 'i dont know', 'whatever', 'basically just',
];

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countMatches(text: string, needles: string[]): number {
  const lower = text.toLowerCase();
  return needles.filter((needle) => lower.includes(needle)).length;
}

export function evaluateAnswer(input: AnswerEvaluationInput): AnswerEvaluation {
  const { question, answerText, durationSeconds } = input;
  const text = answerText.trim();
  const words = countWords(text);

  const improvements: string[] = [];
  const highlights: string[] = [];

  /* --- Relevance --------------------------------------------------------- */
  // Word-overlap between the question's key terms and the answer. Crude, but it
  // reliably catches an answer to a different question.
  const questionTerms = question.text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4);

  const answerLower = text.toLowerCase();
  const overlap = questionTerms.filter((term) => answerLower.includes(term)).length;
  const relevanceRatio = questionTerms.length > 0 ? overlap / questionTerms.length : 0.5;

  let relevance: number;
  if (words < 12) {
    relevance = 3;
    improvements.push(
      'Your answer was very short. Aim for at least 30 seconds of substance — an interviewer needs enough to evaluate.',
    );
  } else if (relevanceRatio >= 0.4) {
    relevance = 9;
    highlights.push('Stayed on the question being asked.');
  } else if (relevanceRatio >= 0.2) {
    relevance = 6;
  } else {
    relevance = 4;
    improvements.push(
      'The answer drifted from the question. Restate the question in your first sentence to anchor the response.',
    );
  }

  /* --- Structure ---------------------------------------------------------- */
  const structureMarkers = countMatches(text, STRUCTURE_MARKERS);

  // The behavioural questions reward STAR explicitly; technical ones less so.
  const expectsStar = question.kind === 'BEHAVIOURAL' || question.kind === 'SITUATIONAL';

  let structure: number;
  if (structureMarkers >= 3) {
    structure = 9;
    highlights.push('Clearly structured — the sequence was easy to follow.');
  } else if (structureMarkers >= 1) {
    structure = expectsStar ? 6 : 7;
  } else if (words >= 60) {
    structure = expectsStar ? 4 : 6;
    if (expectsStar) {
      improvements.push(
        'Use STAR: state the Situation, your Task, the Action you took, and the Result. Signal each transition with a word like "first" or "as a result".',
      );
    }
  } else {
    structure = 4;
  }

  // A behavioural answer with no stated outcome is the single most common miss.
  if (expectsStar && !/result|outcome|so that|led to|increase|decrease|reduc|improv/i.test(text)) {
    improvements.push(
      'You did not state the result. Close every behavioural answer with the outcome — ideally a number.',
    );
    structure = Math.max(2, structure - 2);
  }

  /* --- Depth / specificity ------------------------------------------------ */
  const specificity = SPECIFICITY_PATTERNS.filter((pattern) => pattern.test(text)).length;

  let depth: number;
  if (words < 40) {
    depth = 3;
    if (!improvements.some((i) => i.includes('very short'))) {
      improvements.push('Add detail. Name the tools you used, the size of the problem, and what you personally did.');
    }
  } else if (specificity >= 3) {
    depth = 9;
    highlights.push('Used concrete, specific detail rather than generalities.');
  } else if (specificity >= 1) {
    depth = 7;
  } else {
    depth = 5;
    improvements.push(
      'Add a number or a named tool. "I improved the process" is far weaker than "I cut the weekly report from three hours to forty minutes in Excel".',
    );
  }

  if (question.evaluationHints.length > 0 && words >= 40) {
    // Reward coverage of the hints — each hint is a phrase the bank author
    // expects a strong answer to touch on.
    const hintTerms = question.evaluationHints
      .flatMap((hint) => hint.toLowerCase().split(/\s+/))
      .filter((word) => word.length > 5);
    const hintCoverage = countMatches(answerLower, [...new Set(hintTerms)]) / Math.max(1, hintTerms.length);
    if (hintCoverage > 0.15) {
      depth = Math.min(10, depth + 1);
      highlights.push('Covered the points an interviewer would be listening for.');
    }
  }

  /* --- Communication ------------------------------------------------------ */
  const hedging = countMatches(text, HEDGING_PHRASES);
  const fillerRatio = words > 0 ? (text.match(/\b(um|uh|like|you know)\b/gi)?.length ?? 0) / words : 0;

  let communication: number;
  if (words < 25) {
    communication = 4;
  } else if (hedging === 0 && fillerRatio < 0.02) {
    communication = 9;
    if (words >= 60) highlights.push('Confident, decisive phrasing without hedging.');
  } else if (hedging <= 2) {
    communication = 7;
  } else {
    communication = 5;
    improvements.push(
      `You hedged ${hedging} time${hedging === 1 ? '' : 's'} ("I think maybe", "probably"). State your reasoning directly — it reads as more confident.`,
    );
  }

  // Pace: 120–160 words per minute is a comfortable interview speaking rate.
  if (durationSeconds && durationSeconds > 5) {
    const wpm = (words / durationSeconds) * 60;
    if (wpm > 200) {
      communication = Math.max(3, communication - 2);
      improvements.push(`You spoke at roughly ${Math.round(wpm)} words per minute. Slow down to around 140 — it reads as thoughtful.`);
    } else if (wpm < 70 && words >= 40) {
      communication = Math.max(3, communication - 1);
      improvements.push('You spoke slowly with long pauses. Practise the answer out loud until it flows.');
    }
  }

  const scores = { relevance, structure, depth, communication };
  const overallScore = Math.round(
    ((relevance * 0.3 + structure * 0.25 + depth * 0.25 + communication * 0.2) / 10) * 100,
  );

  /* --- Feedback summary --------------------------------------------------- */
  let feedback: string;
  if (overallScore >= 80) {
    feedback = 'Strong answer. This would land well in a real interview — the structure and detail are both there.';
  } else if (overallScore >= 65) {
    feedback = 'Solid answer with clear substance. Tightening the structure would make it noticeably stronger.';
  } else if (overallScore >= 45) {
    feedback = 'The content is heading in the right direction, but it needs more detail and a clearer shape.';
  } else {
    feedback =
      'This answer would not yet survive a real interview. Work through the improvements below and record it again.';
  }

  // Cap at three so the feedback is actionable rather than overwhelming.
  if (improvements.length === 0) {
    improvements.push('Keep this answer as-is and practise it out loud until it feels natural.');
  }
  if (highlights.length === 0) {
    highlights.push('You answered the question directly, which is the essential starting point.');
  }

  return {
    scores,
    overallScore,
    feedback,
    improvements: improvements.slice(0, 3),
    highlights: highlights.slice(0, 3),
  };
}

export const ruleBasedInterview: InterviewService = {
  generateQuestions: async (input) => generateQuestions(input),
  evaluateAnswer: async (input) => evaluateAnswer(input),
};
