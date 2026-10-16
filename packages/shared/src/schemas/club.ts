import { z } from 'zod';
import { CLUB_CATEGORIES, CLUB_MEMBERSHIP_ROLES, CLUB_MEMBERSHIP_STATUSES } from '../constants.js';
import { listQuerySchema, urlOrPathSchema } from './common.js';

export const clubSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  category: z.enum(CLUB_CATEGORIES),
  logoUrl: z.string().nullable(),
  memberCount: z.number().int().optional(),
});

export const createClubSchema = z.object({
  name: z.string().trim().min(3, 'Club name is too short').max(120),
  category: z.enum(CLUB_CATEGORIES),
  description: z.string().trim().min(20, 'Write at least 20 characters').max(2000),
  logoUrl: urlOrPathSchema.nullable().optional(),
  bannerUrl: urlOrPathSchema.nullable().optional(),
  email: z.string().email().max(160).optional(),
  meetingSchedule: z.string().trim().max(160).nullable().optional(),
  /** Club leads are students; the president must belong to the same college. */
  presidentId: z.string().cuid().nullable().optional(),
  isRecruiting: z.boolean().optional().default(true),
});
export type CreateClubInput = z.infer<typeof createClubSchema>;

export const updateClubSchema = createClubSchema.partial().omit({ presidentId: true });

export const clubListQuerySchema = listQuerySchema.extend({
  category: z.enum(CLUB_CATEGORIES).optional(),
  isRecruiting: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  collegeId: z.string().cuid().optional(),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

export const joinClubSchema = z.object({
  /** Short pitch shown to the club lead reviewing the request. */
  message: z.string().trim().max(500).optional(),
  requestedRole: z.enum(CLUB_MEMBERSHIP_ROLES).default('MEMBER'),
});
export type JoinClubInput = z.infer<typeof joinClubSchema>;

export const updateMembershipSchema = z.object({
  status: z.enum(CLUB_MEMBERSHIP_STATUSES).optional(),
  role: z.enum(CLUB_MEMBERSHIP_ROLES).optional(),
  /** Set by a reviewer when rejecting. */
  reviewNote: z.string().trim().max(500).optional(),
});

export const membershipListQuerySchema = listQuerySchema.extend({
  clubId: z.string().cuid().optional(),
  status: z.enum(CLUB_MEMBERSHIP_STATUSES).optional(),
  role: z.enum(CLUB_MEMBERSHIP_ROLES).optional(),
});
