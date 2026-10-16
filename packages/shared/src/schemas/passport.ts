import { z } from 'zod';
import { PASSPORT_VISIBILITY } from '../constants.js';
import { listQuerySchema } from './common.js';

/**
 * The Student Career Passport — read model assembled from many tables.
 *
 * These schemas describe what the passport *returns*; the write path stays in
 * the feature-specific schemas (events, courses, projects, …). Keeping the DTO
 * here means the web app can render the passport without importing API types.
 */
export const readinessBreakdownSchema = z.object({
  skills: z.number().min(0).max(100),
  projects: z.number().min(0).max(100),
  internship: z.number().min(0).max(100),
  interview: z.number().min(0).max(100),
});

export const passportSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  proficiency: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']),
  score: z.number().int().min(0).max(100),
  /** Where the evidence came from — assessment, course, mentor attestation. */
  source: z.enum(['SELF', 'ASSESSMENT', 'COURSE', 'MENTOR', 'INTERNSHIP']),
  verified: z.boolean(),
});

export const passportExperienceSchema = z.object({
  id: z.string(),
  kind: z.enum(['EVENT', 'CLUB', 'COMPETITION', 'VOLUNTEERING', 'FEST_ROLE']),
  title: z.string(),
  organization: z.string().nullable(),
  role: z.string().nullable(),
  description: z.string().nullable(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullable(),
  certificateId: z.string().nullable(),
});

export const passportEducationSchema = z.object({
  collegeName: z.string(),
  collegeLogoUrl: z.string().nullable(),
  departmentName: z.string().nullable(),
  degree: z.string().nullable(),
  graduationYear: z.number().int().nullable(),
  cgpa: z.number().nullable(),
  rollNumber: z.string().nullable(),
});

export const passportSchema = z.object({
  username: z.string(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  headline: z.string().nullable(),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  visibility: z.enum(PASSPORT_VISIBILITY),
  links: z.object({
    linkedin: z.string().nullable(),
    github: z.string().nullable(),
    portfolio: z.string().nullable(),
  }),
  education: passportEducationSchema,
  careerInterests: z.array(z.string()),
  skills: z.array(passportSkillSchema),
  experience: z.array(passportExperienceSchema),
  projects: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string().nullable(),
      techStack: z.array(z.string()),
      repoUrl: z.string().nullable(),
      liveUrl: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
      approvedAt: z.coerce.date().nullable(),
      rubricScore: z.number().nullable(),
    }),
  ),
  internships: z.array(
    z.object({
      id: z.string(),
      role: z.string(),
      organization: z.string(),
      workMode: z.string(),
      startAt: z.coerce.date(),
      endAt: z.coerce.date().nullable(),
      stipend: z.number().int().nullable(),
      completed: z.boolean(),
    }),
  ),
  certificates: z.array(
    z.object({
      certificateId: z.string(),
      title: z.string(),
      type: z.string(),
      issuedAt: z.coerce.date(),
      issuer: z.string(),
      verified: z.boolean(),
      verifyUrl: z.string(),
    }),
  ),
  readiness: z.object({
    score: z.number().min(0).max(100),
    band: z.string(),
    breakdown: readinessBreakdownSchema,
    /** Human-readable "what to do next" — rule-based today, AI later. */
    suggestions: z.array(z.string()),
    calculatedAt: z.coerce.date(),
  }),
  stats: z.object({
    eventsAttended: z.number().int(),
    certificatesEarned: z.number().int(),
    projectsCompleted: z.number().int(),
    internshipsCompleted: z.number().int(),
  }),
  shareUrl: z.string(),
  generatedAt: z.coerce.date(),
});
export type PassportDto = z.infer<typeof passportSchema>;

export const passportPrivacySchema = z.object({
  visibility: z.enum(PASSPORT_VISIBILITY),
  consentToEmployerSearch: z.boolean().optional(),
});

export const passportExportQuerySchema = z.object({
  format: z.enum(['pdf']).default('pdf'),
  /** Include the full evidence appendix (certificates, rubric scores). */
  includeEvidence: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(true),
});

/* -------------------------------------------------------------------------- */
/* Public / employer-facing discovery                                         */
/* -------------------------------------------------------------------------- */

/**
 * Employer candidate search. Every filter is optional; results are always
 * limited to students who consented AND whose visibility permits employers.
 */
export const candidateSearchQuerySchema = listQuerySchema.extend({
  skillIds: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')))
    .optional(),
  minReadiness: z.coerce.number().min(0).max(100).optional(),
  maxReadiness: z.coerce.number().min(0).max(100).optional(),
  collegeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  graduationYear: z.coerce.number().int().min(2020).max(2040).optional(),
  hasInternship: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  minProjects: z.coerce.number().int().min(0).optional(),
  location: z.string().trim().max(120).optional(),
});
export type CandidateSearchQuery = z.infer<typeof candidateSearchQuerySchema>;
