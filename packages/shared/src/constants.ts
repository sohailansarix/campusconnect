/**
 * Platform-wide constants shared by the API and the web app.
 *
 * Anything that both sides must agree on (enum-ish string unions, label maps,
 * journey steps, pagination defaults) lives here rather than being redefined
 * per app.
 */

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

export const ROLES = [
  'STUDENT',
  'CLUB_LEAD',
  'FACULTY_COORDINATOR',
  'COLLEGE_ADMIN',
  'TRAINER',
  'EMPLOYER',
  'SUPER_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  STUDENT: 'Student',
  CLUB_LEAD: 'Club Lead',
  FACULTY_COORDINATOR: 'Faculty Coordinator',
  COLLEGE_ADMIN: 'College Admin / Placement Officer',
  TRAINER: 'Trainer / Career Mentor',
  EMPLOYER: 'Employer / Recruiter',
  SUPER_ADMIN: 'Platform Super Admin',
};

/** Roles that belong to a college tenant and therefore require a collegeId. */
export const COLLEGE_SCOPED_ROLES: Role[] = [
  'STUDENT',
  'CLUB_LEAD',
  'FACULTY_COORDINATOR',
  'COLLEGE_ADMIN',
];

/** Short description used on the role-picker during signup. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  STUDENT: 'Discover events, build skills and land your first role.',
  CLUB_LEAD: 'Run club activities and manage event participation.',
  FACULTY_COORDINATOR: 'Approve events and mentor student initiatives.',
  COLLEGE_ADMIN: 'Manage the institution, certificates and placement readiness.',
  TRAINER: 'Create courses, review projects and run mock interviews.',
  EMPLOYER: 'Post opportunities and hire ready candidates.',
  SUPER_ADMIN: 'Operate the platform across all colleges and employers.',
};

/* -------------------------------------------------------------------------- */
/* Journey                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The nine-stage journey from the product brief. `key` values are stable
 * identifiers used for analytics funnels and dashboard steppers; `label` is
 * display copy. Lens maps the stage to the layer that owns it.
 */
export const JOURNEY_STAGES = [
  { key: 'discover', label: 'Discover', layer: 'campusconnect', description: 'Find events, clubs and opportunities across your campus.' },
  { key: 'participate', label: 'Participate', layer: 'campusconnect', description: 'Register, attend, and earn a verified certificate.' },
  { key: 'assess', label: 'Assess', layer: 'skillbridge', description: 'Benchmark your skills and find your gaps.' },
  { key: 'learn', label: 'Learn', layer: 'skillbridge', description: 'Follow a roadmap and complete short career courses.' },
  { key: 'build', label: 'Build', layer: 'skillbridge', description: 'Ship real projects reviewed against a rubric.' },
  { key: 'experience', label: 'Experience', layer: 'skillbridge', description: 'Gain internship and industry project experience.' },
  { key: 'prepare', label: 'Prepare', layer: 'careerconnect', description: 'Build your resume and practise mock interviews.' },
  { key: 'apply', label: 'Apply', layer: 'careerconnect', description: 'Apply to matched jobs with your Career Passport.' },
  { key: 'hired', label: 'Get Hired', layer: 'careerconnect', description: 'Track offers and start your career.' },
] as const;

export type JourneyStageKey = (typeof JOURNEY_STAGES)[number]['key'];

/** The seven-step stepper shown on the marketing landing page. */
export const LANDING_JOURNEY_STEPS = [
  'Discover',
  'Participate',
  'Learn',
  'Get Certified',
  'Gain Experience',
  'Prepare',
  'Get Hired',
] as const;

export const LAYERS = [
  { key: 'campusconnect', name: 'CampusConnect', tagline: 'Your campus, organised', accent: 'blue' },
  { key: 'skillbridge', name: 'SkillBridge', tagline: 'Skills that get you hired', accent: 'teal' },
  { key: 'careerconnect', name: 'CareerConnect', tagline: 'Where preparation meets opportunity', accent: 'purple' },
] as const;

export type LayerKey = (typeof LAYERS)[number]['key'];

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export const EVENT_CATEGORIES = [
  'WORKSHOP',
  'SEMINAR',
  'HACKATHON',
  'COMPETITION',
  'BOOTCAMP',
  'WEBINAR',
  'CULTURAL',
  'SPORTS',
  'FEST',
  'CLUB_ACTIVITY',
  'PLACEMENT_DRIVE',
  'OTHER',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  WORKSHOP: 'Workshop',
  SEMINAR: 'Seminar',
  HACKATHON: 'Hackathon',
  COMPETITION: 'Competition',
  BOOTCAMP: 'Bootcamp',
  WEBINAR: 'Webinar',
  CULTURAL: 'Cultural',
  SPORTS: 'Sports',
  FEST: 'Fest',
  CLUB_ACTIVITY: 'Club Activity',
  PLACEMENT_DRIVE: 'Placement Drive',
  OTHER: 'Other',
};

export const EVENT_MODES = ['ONLINE', 'OFFLINE', 'HYBRID'] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const EVENT_STATUSES = [
  'DRAFT',
  'PENDING_FACULTY',
  'PENDING_ADMIN',
  'PUBLISHED',
  'REJECTED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * Approval chain: a club lead submits, the faculty coordinator clears it, and
 * the college admin publishes. Admins may approve both stages in one action.
 */
export const EVENT_APPROVAL_CHAIN = ['PENDING_FACULTY', 'PENDING_ADMIN'] as const;

export const REGISTRATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'WAITLISTED',
  'CANCELLED',
  'ATTENDED',
  'NO_SHOW',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const ATTENDANCE_METHODS = ['QR_SCAN', 'MANUAL', 'SELF_CHECKIN'] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];

/* -------------------------------------------------------------------------- */
/* Certificates                                                               */
/* -------------------------------------------------------------------------- */

export const CERTIFICATE_TYPES = [
  'EVENT_PARTICIPATION',
  'EVENT_WINNER',
  'EVENT_VOLUNTEER',
  'COURSE_COMPLETION',
  'SKILL_ASSESSMENT',
  'INTERNSHIP_COMPLETION',
] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CERTIFICATE_STATUSES = ['PENDING', 'ISSUED', 'REVOKED', 'EXPIRED'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

/** Human-readable certificate ID format: CC-2026-A7F3K2 (Crockford-ish base32). */
export const CERTIFICATE_ID_PREFIX = 'CC';
export const CERTIFICATE_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CERTIFICATE_ID_LENGTH = 6;

/* -------------------------------------------------------------------------- */
/* Clubs                                                                      */
/* -------------------------------------------------------------------------- */

export const CLUB_MEMBERSHIP_ROLES = [
  'MEMBER',
  'CORE_TEAM',
  'SECRETARY',
  'TREASURER',
  'VICE_PRESIDENT',
  'PRESIDENT',
] as const;
export type ClubMembershipRole = (typeof CLUB_MEMBERSHIP_ROLES)[number];

export const CLUB_MEMBERSHIP_STATUSES = ['PENDING', 'ACTIVE', 'REJECTED', 'LEFT'] as const;
export type ClubMembershipStatus = (typeof CLUB_MEMBERSHIP_STATUSES)[number];

export const CLUB_CATEGORIES = [
  'TECHNICAL',
  'CULTURAL',
  'SPORTS',
  'SOCIAL',
  'ENTREPRENEURSHIP',
  'LITERARY',
  'PROFESSIONAL',
  'OTHER',
] as const;
export type ClubCategory = (typeof CLUB_CATEGORIES)[number];

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export const NOTIFICATION_TYPES = [
  'EVENT_REGISTRATION',
  'EVENT_REMINDER',
  'EVENT_UPDATED',
  'CERTIFICATE_ISSUED',
  'DEADLINE_ALERT',
  'APPLICATION_STATUS',
  'INTERVIEW_SCHEDULE',
  'JOB_MATCH',
  'CLUB_MEMBERSHIP',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Notification channels. Push/WhatsApp/SMS adapters are stubs in Phase 1. */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'WHATSAPP', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/* -------------------------------------------------------------------------- */
/* Skills & learning (Phase 2 models, constants declared now for the schema)   */
/* -------------------------------------------------------------------------- */

export const PROFICIENCY_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export const PROFICIENCY_SCORE: Record<ProficiencyLevel, number> = {
  BEGINNER: 25,
  INTERMEDIATE: 50,
  ADVANCED: 75,
  EXPERT: 95,
};

export const COURSE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const ENROLLMENT_STATUSES = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const PROJECT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'NEEDS_REVISION',
  'REJECTED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* Career                                                                     */
/* -------------------------------------------------------------------------- */

export const OPPORTUNITY_TYPES = ['JOB', 'INTERNSHIP'] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const WORK_MODES = ['REMOTE', 'ONSITE', 'HYBRID'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const JOB_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'CLOSED', 'ARCHIVED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * The application pipeline. `order` drives the kanban board columns and the
 * student-facing tracker stepper.
 */
export const APPLICATION_STATUSES = [
  'APPLIED',
  'UNDER_REVIEW',
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_PIPELINE: { status: ApplicationStatus; label: string; order: number }[] = [
  { status: 'APPLIED', label: 'Applied', order: 1 },
  { status: 'UNDER_REVIEW', label: 'Under Review', order: 2 },
  { status: 'SHORTLISTED', label: 'Shortlisted', order: 3 },
  { status: 'INTERVIEW_SCHEDULED', label: 'Interview', order: 4 },
  { status: 'INTERVIEWED', label: 'Interviewed', order: 5 },
  { status: 'OFFER', label: 'Offer', order: 6 },
  { status: 'HIRED', label: 'Hired', order: 7 },
];

/** Terminal states that exit the happy-path funnel. */
export const APPLICATION_TERMINAL_STATUSES: ApplicationStatus[] = ['REJECTED', 'WITHDRAWN'];

export const PASSPORT_VISIBILITY = ['PUBLIC', 'EMPLOYERS_ONLY', 'PRIVATE'] as const;
export type PassportVisibility = (typeof PASSPORT_VISIBILITY)[number];

/* -------------------------------------------------------------------------- */
/* Career readiness                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The Career Readiness score is a weighted blend of four evidence pillars.
 * Weights must sum to 1. Tune here — the API reads these values rather than
 * hard-coding them.
 */
export const READINESS_WEIGHTS = {
  skills: 0.3,
  projects: 0.25,
  internship: 0.25,
  interview: 0.2,
} as const;

export const READINESS_BANDS = [
  { min: 80, label: 'Interview Ready', tone: 'emerald' },
  { min: 60, label: 'Nearly Ready', tone: 'blue' },
  { min: 40, label: 'Developing', tone: 'amber' },
  { min: 0, label: 'Getting Started', tone: 'slate' },
] as const;

export function readinessBand(score: number) {
  return READINESS_BANDS.find((b) => score >= b.min) ?? READINESS_BANDS[READINESS_BANDS.length - 1];
}

/* -------------------------------------------------------------------------- */
/* Subscriptions & payments                                                   */
/* -------------------------------------------------------------------------- */

export const SUBSCRIPTION_PLANS = [
  'FREE',
  'PREMIUM_STUDENT',
  'COLLEGE_STARTER',
  'COLLEGE_PRO',
  'ENTERPRISE',
] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'TRIALING'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_STATUSES = ['CREATED', 'PENDING', 'PAID', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* API conventions                                                            */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const API_PREFIX = '/api/v1';
export const SWAGGER_PATH = '/api/docs';

/** Public certificate verification page path. */
export const verifyPath = (certificateId: string) => `/verify/${certificateId}`;
/** Public career passport page path. */
export const passportPath = (username: string) => `/passport/${username}`;

/** Coarse, non-sensitive event categories used in the public landing page copy. */
export const LANDING_STAT_PLACEHOLDER_NOTE =
  'Illustrative platform metrics — placeholder values, not live data.';
