import { z } from 'zod';
import { listQuerySchema } from './common.js';

/**
 * Event feedback. Ratings drive the organiser analytics summary; the comment is
 * shown verbatim to the organiser and (redacted) on the public event page.
 */
export const createFeedbackSchema = z.object({
  rating: z.coerce
    .number()
    .int()
    .min(1, 'Pick a rating from 1 to 5')
    .max(5),
  /** Optional per-dimension scores — all default to `rating` when omitted. */
  contentRating: z.coerce.number().int().min(1).max(5).optional(),
  speakerRating: z.coerce.number().int().min(1).max(5).optional(),
  organizationRating: z.coerce.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(2000).optional(),
  /** Surfaced separately in the organiser summary, never on the public page. */
  suggestions: z.string().trim().max(2000).optional(),
  wouldRecommend: z.boolean().optional(),
  anonymous: z.boolean().default(false),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

export const feedbackListQuerySchema = listQuerySchema.extend({
  eventId: z.string().cuid().optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  maxRating: z.coerce.number().int().min(1).max(5).optional(),
});

/** Roster of attendees who have not yet submitted feedback — powers reminders. */
export const pendingFeedbackQuerySchema = z.object({
  eventId: z.string().cuid().optional(),
});
