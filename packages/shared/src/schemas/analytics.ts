import { z } from 'zod';
import { csvArray } from './common.js';

/**
 * Analytics query surface.
 *
 * Every endpoint here is college-scoped (or platform-scoped for SUPER_ADMIN).
 * `from`/`to` default to the trailing 90 days when omitted, so charts always
 * have a window without the client having to compute one.
 */
export const analyticsRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  collegeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  /** Cohort filter for student-engagement metrics. */
  graduationYear: z.coerce.number().int().min(2020).max(2040).optional(),
  /** Bucket size for time-series endpoints. */
  granularity: z.enum(['DAY', 'WEEK', 'MONTH']).default('MONTH'),
});
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeSchema>;

export const eventAnalyticsQuerySchema = analyticsRangeSchema.extend({
  eventId: z.string().cuid().optional(),
  category: csvArray(z.enum([
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
  ])),
});

export const placementAnalyticsQuerySchema = analyticsRangeSchema.extend({
  internshipOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

/** CSV export shares the shape of the report it exports, plus a format switch. */
export const exportQuerySchema = analyticsRangeSchema.extend({
  format: z.enum(['csv', 'json']).default('csv'),
  report: z.enum([
    'EVENT_ENGAGEMENT',
    'ATTENDANCE',
    'CERTIFICATES',
    'STUDENT_ENGAGEMENT',
    'PLACEMENT_FUNNEL',
    'DEPARTMENT_COMPARISON',
    'APPLICATIONS',
  ]),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Response shapes (informative — the API is the source of truth at runtime)   */
/* -------------------------------------------------------------------------- */

export const eventEngagementResponseSchema = z.object({
  totals: z.object({
    events: z.number().int(),
    registrations: z.number().int(),
    attendance: z.number().int(),
    certificatesIssued: z.number().int(),
    averageRating: z.number().nullable(),
  }),
  registrationVsAttendance: z.array(
    z.object({
      bucket: z.string(),
      registrations: z.number().int(),
      attendance: z.number().int(),
    }),
  ),
  popularCategories: z.array(
    z.object({ category: z.string(), count: z.number().int(), attendanceRate: z.number() }),
  ),
  byDepartment: z.array(
    z.object({
      departmentId: z.string().nullable(),
      departmentName: z.string(),
      participants: z.number().int(),
      engagementScore: z.number(),
    }),
  ),
  byYear: z.array(z.object({ year: z.number().int(), participants: z.number().int() })),
  clubActivity: z.array(
    z.object({ clubId: z.string(), clubName: z.string(), events: z.number().int(), participants: z.number().int() }),
  ),
  feedbackSummary: z.object({
    responses: z.number().int(),
    averageRating: z.number().nullable(),
    distribution: z.array(z.object({ rating: z.number().int(), count: z.number().int() })),
    topSuggestions: z.array(z.string()),
  }),
});

export const readinessAnalyticsResponseSchema = z.object({
  distribution: z.array(
    z.object({ band: z.string(), min: z.number(), count: z.number().int() }),
  ),
  average: z.number(),
  skillGapsByDepartment: z.array(
    z.object({
      departmentName: z.string(),
      gap: z.string(),
      studentsAffected: z.number().int(),
    }),
  ),
  internshipOutcomes: z.object({
    applied: z.number().int(),
    secured: z.number().int(),
    completionRate: z.number(),
  }),
});
