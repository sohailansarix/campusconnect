import { z } from 'zod';
import {
  EVENT_CATEGORIES,
  EVENT_MODES,
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
} from '../constants.js';
import { amountSchema, csvArray, listQuerySchema, urlOrPathSchema } from './common.js';

/* -------------------------------------------------------------------------- */
/* Create / update                                                            */
/* -------------------------------------------------------------------------- */

/**
 * An event's time window is the single most common source of bad data: end
 * before start, a deadline after the event begins, a six-month "workshop".
 * All three are rejected here rather than trusted downstream.
 */
const eventTimingFields = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  registrationDeadline: z.coerce.date().optional(),
});

function addEventTimingIssues(
  value: { startAt: Date; endAt: Date; registrationDeadline?: Date },
  ctx: z.RefinementCtx,
): void {
  if (value.endAt <= value.startAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'End time must be after the start time',
      path: ['endAt'],
    });
  }
  if (value.endAt.getTime() - value.startAt.getTime() > 1000 * 60 * 60 * 24 * 14) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'An event cannot run longer than 14 days',
      path: ['endAt'],
    });
  }
  if (value.registrationDeadline && value.registrationDeadline > value.startAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Registration must close on or before the start time',
      path: ['registrationDeadline'],
    });
  }
}

export const eventTimingSchema = eventTimingFields.superRefine(addEventTimingIssues);

const eventBaseSchema = z.object({
  title: z.string().trim().min(5, 'Title is too short').max(160),
  description: z.string().trim().min(30, 'Describe the event in at least 30 characters').max(8000),
  summary: z.string().trim().max(280).optional(),
  category: z.enum(EVENT_CATEGORIES),
  mode: z.enum(EVENT_MODES).default('OFFLINE'),

  /** Required for OFFLINE/HYBRID, ignored for ONLINE — enforced below. */
  venue: z.string().trim().max(200).optional(),
  /** Required for ONLINE/HYBRID. */
  meetingUrl: z.string().url().max(500).optional(),

  bannerUrl: urlOrPathSchema.nullable().optional(),
  /** 0 = unlimited. */
  capacity: z.coerce.number().int().min(0).max(100_000).default(0),
  waitlistEnabled: z.boolean().default(true),
  /** Fee in paise. 0 means free. */
  fee: amountSchema.default(0),
  currency: z.string().length(3).default('INR'),

  certificateEnabled: z.boolean().default(true),
  /** Which certificate the organiser intends to issue; locked once issued. */
  certificateTemplateId: z.string().cuid().nullable().optional(),

  /** Optional scope — omit to target the whole college. */
  clubId: z.string().cuid().nullable().optional(),
  departmentId: z.string().cuid().nullable().optional(),
  /** Empty array = open to all years/departments. */
  eligibleYears: z.array(z.coerce.number().int().min(1).max(6)).max(6).default([]),
  tags: z.array(z.string().trim().min(2).max(30)).max(10).default([]),

  contactEmail: z.string().email().max(160).optional(),
  contactPhone: z.string().trim().max(20).optional(),
});

export const createEventSchema = eventBaseSchema
  .merge(eventTimingFields)
  .superRefine((v, ctx) => {
    addEventTimingIssues(v, ctx);
    if ((v.mode === 'OFFLINE' || v.mode === 'HYBRID') && !v.venue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A venue is required for offline and hybrid events',
        path: ['venue'],
      });
    }
    if ((v.mode === 'ONLINE' || v.mode === 'HYBRID') && !v.meetingUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A meeting link is required for online and hybrid events',
        path: ['meetingUrl'],
      });
    }
    if (v.registrationDeadline && v.registrationDeadline <= new Date()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Registration deadline must be in the future',
        path: ['registrationDeadline'],
      });
    }
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

/**
 * Updates re-run the timing and mode rules against the merged record in the
 * service layer — a partial patch cannot be validated in isolation, so the
 * schema stays permissive here and `EventService.update` re-validates.
 */
export const updateEventSchema = eventBaseSchema.partial().extend({
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  registrationDeadline: z.coerce.date().nullable().optional(),
});

export const submitEventForApprovalSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/** Approval decisions. The chain is faculty → admin. */
export const eventApprovalSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.note && v.note.length >= 10), {
    message: 'Explain what needs to change (at least 10 characters)',
    path: ['note'],
  });
export type EventApprovalInput = z.infer<typeof eventApprovalSchema>;

/* -------------------------------------------------------------------------- */
/* List / filter                                                              */
/* -------------------------------------------------------------------------- */

export const eventListQuerySchema = listQuerySchema.extend({
  category: csvArray(z.enum(EVENT_CATEGORIES)),
  mode: csvArray(z.enum(EVENT_MODES)),
  status: csvArray(z.enum(EVENT_STATUSES)),
  clubId: z.string().cuid().optional(),
  collegeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  organizerId: z.string().cuid().optional(),
  /** `true` = free only, `false` = paid only. */
  free: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Restrict to events the caller has registered for. */
  registered: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  /** Restrict to events with seats remaining. */
  available: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  /** Default view on the events page: published + ongoing only. */
  upcomingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(true),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

/** Calendar view — bounded to a single month to keep the payload small. */
export const eventCalendarQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020).max(2100),
  collegeId: z.string().cuid().optional(),
  category: csvArray(z.enum(EVENT_CATEGORIES)),
  mode: csvArray(z.enum(EVENT_MODES)),
  clubId: z.string().cuid().optional(),
  search: z.string().trim().max(160).optional(),
  free: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export const registerForEventSchema = z.object({
  /** Answers to organiser-defined questions, e.g. dietary needs, team name. */
  responses: z.record(z.string().max(1000)).optional(),
  /** Required when the event is paid and the provider supports it. */
  paymentReference: z.string().trim().max(120).optional(),
  acceptWaitlist: z.boolean().default(true),
});
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;

export const cancelRegistrationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const registrationListQuerySchema = listQuerySchema.extend({
  eventId: z.string().cuid().optional(),
  studentId: z.string().cuid().optional(),
  status: csvArray(z.enum(REGISTRATION_STATUSES)),
});

export const myRegistrationQuerySchema = listQuerySchema.extend({
  status: csvArray(z.enum(REGISTRATION_STATUSES)),
  upcomingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
