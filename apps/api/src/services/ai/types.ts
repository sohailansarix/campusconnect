/**
 * AI service contracts.
 *
 * Every method that will eventually be LLM-backed is declared here with a
 * rule-based implementation shipped today. The point of doing this in Phase 1 is
 * that the *call sites* are already written against the final shape — dropping in
 * a model later means implementing one interface and flipping `AI_DRIVER`, not
 * rewriting features.
 *
 * Rules for every implementation in this folder:
 *
 *  1. Deterministic. Same input → same output. These results populate the Career
 *     Passport and are shown to employers, so they must be reproducible and
 *     auditable.
 *  2. Explainable. Every suggestion carries a `reason` string derived from the
 *     data that produced it. A number with no justification is worse than no
 *     number, especially to a student deciding what to do next.
 *  3. Non-throwing. A failure here degrades a recommendation panel to empty; it
 *     must never fail the request that triggered it.
 */

import type { ProficiencyLevel, Role } from '@campusconnect/shared';

/* -------------------------------------------------------------------------- */
/* Career readiness                                                           */
/* -------------------------------------------------------------------------- */

export type ReadinessInput = {
  skills: {
    score: number;
    verified: boolean;
    proficiency: ProficiencyLevel;
    categoryName: string;
    name: string;
  }[];
  projects: { approved: boolean; score: number | null; techStack: string[]; difficulty: number }[];
  internships: {
    completed: boolean;
    isPremium: boolean;
    durationMonths: number | null;
    role: string;
  }[];
  interviews: {
    completed: boolean;
    overallScore: number | null;
    communicationScore: number | null;
    confidenceScore: number | null;
    contentScore: number | null;
  }[];
  /** Certificates earned from events, courses and assessments. */
  certificateCount: number;
  /** Distinct events attended — breadth of campus engagement. */
  eventsAttended: number;
  /** Target role, used to weight skills that matter for the track. */
  careerInterests: string[];
};

export type ReadinessPillar = {
  score: number;
  /** Human-readable explanation, e.g. "3 approved projects, 1 with rubric score ≥80". */
  rationale: string;
};

export type ReadinessResult = {
  score: number;
  band: string;
  breakdown: {
    skills: number;
    projects: number;
    internship: number;
    interview: number;
  };
  /** Ordered, actionable next steps. First entry is the highest-impact action. */
  suggestions: Suggestion[];
  /** Per-pillar explanation, for the "how is this calculated?" panel. */
  pillars: {
    skills: ReadinessPillar;
    projects: ReadinessPillar;
    internship: ReadinessPillar;
    interview: ReadinessPillar;
  };
  calculatedAt: Date;
};

export type Suggestion = {
  /** Stable key so the UI can dedupe across recalculations. */
  id: string;
  title: string;
  description: string;
  reason: string;
  /** Estimated readiness points gained by acting on it. */
  impact: number;
  actionType: 'ATTEND_EVENT' | 'TAKE_ASSESSMENT' | 'START_COURSE' | 'BUILD_PROJECT' | 'APPLY' | 'BOOK_MOCK' | 'COMPLETE_PROFILE';
  /** Route the CTA points at. */
  actionUrl: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
};

/* -------------------------------------------------------------------------- */
/* Recommendations                                                            */
/* -------------------------------------------------------------------------- */

export type RecommendationInput = {
  userId: string;
  collegeId: string | null;
  departmentId: string | null;
  graduationYear: number | null;
  careerInterests: string[];
  /** Skill names the student already holds at INTERMEDIATE or above. */
  strongSkills: string[];
  /** Skill names flagged as gaps by an assessment. */
  gapSkills: string[];
  /** Category ids the student has engaged with before (for variety scoring). */
  recentCategoryIds: string[];
};

export type RecommendedItem<T = Record<string, unknown>> = {
  id: string;
  title: string;
  /** 0–100. Higher is a stronger match. */
  score: number;
  /** Why this was surfaced — shown on the card, never hidden. */
  reasons: string[];
  item: T;
};

export interface RecommendationService {
  recommendEvents(input: RecommendationInput, limit: number): Promise<RecommendedItem[]>;
  recommendCourses(input: RecommendationInput, limit: number): Promise<RecommendedItem[]>;
  recommendOpportunities(input: RecommendationInput, limit: number): Promise<RecommendedItem[]>;
}

/* -------------------------------------------------------------------------- */
/* Skill gap                                                                  */
/* -------------------------------------------------------------------------- */

export type SkillGapInput = {
  currentSkills: { name: string; categoryName: string; score: number; proficiency: ProficiencyLevel }[];
  /** Skills the target role requires, with the level employers expect. */
  requiredSkills: { name: string; categoryName: string; expectedLevel: ProficiencyLevel; weight: number }[];
  targetRole: string;
};

export type SkillGap = {
  skillName: string;
  categoryName: string;
  currentLevel: ProficiencyLevel | 'NONE';
  currentScore: number;
  expectedLevel: ProficiencyLevel;
  /** Positive number of points the student is short by. */
  gap: number;
  /** How much closing this gap matters for the target role, 0–1. */
  importance: number;
  /** Ordered learning steps for this specific skill. */
  recommendation: string;
};

export type SkillGapResult = {
  targetRole: string;
  /** 0–100, weighted coverage of the required skill set. */
  matchPercentage: number;
  gaps: SkillGap[];
  strengths: { name: string; score: number; categoryName: string }[];
  summary: string;
};

export interface SkillGapService {
  analyse(input: SkillGapInput): Promise<SkillGapResult>;
}

/* -------------------------------------------------------------------------- */
/* Resume                                                                     */
/* -------------------------------------------------------------------------- */

export type ResumeQualityInput = {
  hasSummary: boolean;
  summaryWordCount: number;
  experienceCount: number;
  projectCount: number;
  skillCount: number;
  certificateCount: number;
  hasLinkedin: boolean;
  hasGithub: boolean;
  hasPortfolio: boolean;
  /** Bullets that start with a weak verb. */
  weakVerbCount: number;
  /** Bullets containing a number or percentage. */
  quantifiedBulletCount: number;
  totalBulletCount: number;
  /** Free text scanned for filler phrases. */
  rawText: string;
};

export type ResumeSuggestion = {
  id: string;
  section: 'SUMMARY' | 'EXPERIENCE' | 'PROJECTS' | 'SKILLS' | 'EDUCATION' | 'LINKS' | 'FORMATTING';
  severity: 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';
  title: string;
  detail: string;
  /** Optional before/after example so the advice is concrete. */
  example?: { before: string; after: string };
  /** Points gained by fixing it. */
  impact: number;
};

export type ResumeQualityResult = {
  score: number;
  band: string;
  suggestions: ResumeSuggestion[];
  /** Section-by-section score, for the builder's sidebar. */
  sectionScores: Record<string, number>;
};

export interface ResumeSuggestionService {
  review(input: ResumeQualityInput): Promise<ResumeQualityResult>;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

export type CandidateMatchInput = {
  candidate: {
    readinessScore: number;
    skills: { name: string; score: number; proficiency: ProficiencyLevel }[];
    projectCount: number;
    hasInternship: boolean;
    graduationYear: number | null;
    location: string | null;
    collegeId: string | null;
    departmentId: string | null;
    careerInterests: string[];
  };
  job: {
    id: string;
    title: string;
    requiredSkills: { name: string; weight: number; minLevel: ProficiencyLevel; required: boolean }[];
    location: string | null;
    workMode: string;
    minReadinessScore: number | null;
    eligibleGraduationYears: number[];
    eligibleCollegeIds: string[];
    experienceMinYears: number;
  };
};

export type MatchResult = {
  /** 0–100 composite score. */
  score: number;
  /** Contributing factors, each with its own score and explanation. */
  factors: { name: string; score: number; weight: number; reason: string }[];
  /** True when a hard eligibility rule excludes the candidate regardless of score. */
  disqualified: boolean;
  disqualificationReason?: string;
  strengths: string[];
  gaps: string[];
};

export interface JobMatchingService {
  score(input: CandidateMatchInput): Promise<MatchResult>;
  rankCandidates(inputs: CandidateMatchInput[], limit: number): Promise<(MatchResult & { jobId: string })[]>;
}

/* -------------------------------------------------------------------------- */
/* Learning paths                                                             */
/* -------------------------------------------------------------------------- */

export type LearningPathInput = {
  targetRole: string;
  currentSkills: { name: string; score: number }[];
  requiredSkills: { name: string; expectedLevel: ProficiencyLevel; weight: number }[];
  availableCourses: { id: string; title: string; skillNames: string[]; durationMinutes: number | null; isPremium: boolean; level: CourseLevelLike }[];
  availableProjects: { id: string; title: string; skillIds: string[]; difficulty: number }[];
  weeklyHoursAvailable: number;
};

type CourseLevelLike = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type LearningStep = {
  order: number;
  title: string;
  description: string;
  actionType: 'COMPLETE_COURSE' | 'BUILD_PROJECT' | 'TAKE_ASSESSMENT' | 'ATTEND_EVENT' | 'APPLY';
  targetId: string | null;
  estimatedHours: number;
  addressesGap: string;
  rationale: string;
};

export type LearningPathResult = {
  targetRole: string;
  steps: LearningStep[];
  totalEstimatedHours: number;
  /** Weeks to completion at the student's stated availability. */
  estimatedWeeks: number;
  generatedBy: string;
};

export interface LearningPathService {
  generate(input: LearningPathInput): Promise<LearningPathResult>;
}

/* -------------------------------------------------------------------------- */
/* Mock interview                                                             */
/* -------------------------------------------------------------------------- */

export type InterviewQuestionInput = {
  role: string;
  /** Question categories to draw from. */
  kinds?: ('TECHNICAL' | 'BEHAVIOURAL' | 'SITUATIONAL' | 'ROLE_SPECIFIC')[];
  count: number;
  /** Questions the candidate has already seen, so practice does not repeat. */
  excludeIds?: string[];
  difficulty?: number;
};

export type InterviewQuestion = {
  id: string;
  text: string;
  kind: 'TECHNICAL' | 'BEHAVIOURAL' | 'SITUATIONAL' | 'ROLE_SPECIFIC';
  difficulty: number;
  /** What a strong answer covers. Shown only after the candidate answers. */
  evaluationHints: string[];
  /** Rough time a good answer takes. */
  suggestedSeconds: number;
};

export type AnswerEvaluationInput = {
  question: InterviewQuestion;
  answerText: string;
  /** Seconds spent answering, when recorded. */
  durationSeconds?: number | null;
};

export type AnswerEvaluation = {
  /** 0–10 per dimension. */
  scores: { relevance: number; structure: number; depth: number; communication: number };
  overallScore: number;
  feedback: string;
  /** Concrete improvements, not generic encouragement. */
  improvements: string[];
  /** Sentences in the answer worth keeping. */
  highlights: string[];
};

export interface InterviewService {
  generateQuestions(input: InterviewQuestionInput): Promise<InterviewQuestion[]>;
  evaluateAnswer(input: AnswerEvaluationInput): Promise<AnswerEvaluation>;
}

/* -------------------------------------------------------------------------- */
/* Facade                                                                     */
/* -------------------------------------------------------------------------- */

export type AiDriver = 'rule-based' | 'llm';

export interface AiServices {
  readonly driver: AiDriver;
  readiness: {
    calculate(input: ReadinessInput): Promise<ReadinessResult>;
  };
  recommendations: RecommendationService;
  skillGap: SkillGapService;
  resume: ResumeSuggestionService;
  matching: JobMatchingService;
  learningPath: LearningPathService;
  interview: InterviewService;
}

/** Shared shape for a persisted recommendation, used by the coach service. */
export type CoachMessage = {
  role: Role | 'SYSTEM';
  content: string;
  createdAt: Date;
};
