import { z } from 'zod';
import { PASSPORT_VISIBILITY, PROFICIENCY_LEVELS, ROLES } from '../constants.js';
import { emailSchema, fullNameSchema, usernameSchema } from './auth.js';
import { listQuerySchema, urlOrPathSchema } from './common.js';

/* -------------------------------------------------------------------------- */
/* Institution                                                                */
/* -------------------------------------------------------------------------- */

export const collegeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  logoUrl: z.string().nullable(),
});

export const departmentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
});

/* -------------------------------------------------------------------------- */
/* Profile updates                                                            */
/* -------------------------------------------------------------------------- */

export const updateUserSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[+]?[0-9\s-]{7,20}$/, 'Enter a valid phone number')
      .nullable()
      .optional(),
    avatarUrl: urlOrPathSchema.nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const updateStudentProfileSchema = z.object({
  username: usernameSchema.optional(),
  rollNumber: z.string().trim().max(40).nullable().optional(),
  departmentId: z.string().cuid().nullable().optional(),
  graduationYear: z.coerce.number().int().min(2020).max(2040).nullable().optional(),
  cgpa: z.coerce.number().min(0).max(10).nullable().optional(),
  headline: z.string().trim().max(140).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  linkedinUrl: z.string().url().max(300).nullable().optional(),
  githubUrl: z.string().url().max(300).nullable().optional(),
  portfolioUrl: z.string().url().max(300).nullable().optional(),
  careerInterests: z.array(z.string().trim().min(2).max(60)).max(12).optional(),
  passportVisibility: z.enum(PASSPORT_VISIBILITY).optional(),
  /** Explicit opt-in required before an employer can see this profile. */
  consentToEmployerSearch: z.boolean().optional(),
});

export const updateCollegeSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  logoUrl: urlOrPathSchema.nullable().optional(),
  website: z.string().url().max(300).nullable().optional(),
  placementEmail: emailSchema.nullable().optional(),
});

export const departmentInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Use letters and numbers only'),
});

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

export const userListQuerySchema = listQuerySchema.extend({
  role: z.enum(ROLES).optional(),
  collegeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  graduationYear: z.coerce.number().int().optional(),
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

export const studentProfileUpdateInputSchema = updateStudentProfileSchema;
