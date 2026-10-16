import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '../constants.js';
import { listQuerySchema } from './common.js';

export const notificationListQuerySchema = listQuerySchema.extend({
  type: z.enum(NOTIFICATION_TYPES).optional(),
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

export const markNotificationsReadSchema = z
  .object({
    /** Omit both to mark everything read. */
    ids: z.array(z.string().cuid()).max(500).optional(),
    type: z.enum(NOTIFICATION_TYPES).optional(),
  })
  .default({});

/**
 * Per-user notification preferences. Each type can be muted per channel; the UI
 * renders this as a matrix of switches on the settings screen.
 */
export const notificationPreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1),
});

export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).min(1).max(NOTIFICATION_TYPES.length),
  /** Global mute — still persists notifications in-app, just sends no email. */
  emailEnabled: z.boolean().optional(),
  digestFrequency: z.enum(['INSTANT', 'DAILY', 'WEEKLY', 'NEVER']).optional(),
});

/** Admin/college-wide broadcast. Rate-limited to keep it a deliberate action. */
export const broadcastNotificationSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1000),
  actionUrl: z.string().trim().max(300).optional(),
  audience: z.enum(['ALL_STUDENTS', 'DEPARTMENT', 'EVENT_REGISTRANTS', 'CLUB_MEMBERS', 'CUSTOM']),
  departmentId: z.string().cuid().optional(),
  eventId: z.string().cuid().optional(),
  clubId: z.string().cuid().optional(),
  userIds: z.array(z.string().cuid()).max(5000).optional(),
});

/** Internal payload shapes used when the service enqueues a notification. */
export const notificationPayloadSchemas = {
  EVENT_REGISTRATION: z.object({
    eventId: z.string(),
    eventTitle: z.string(),
    startAt: z.coerce.date(),
    passUrl: z.string(),
  }),
  EVENT_REMINDER: z.object({
    eventId: z.string(),
    eventTitle: z.string(),
    startAt: z.coerce.date(),
    hoursUntil: z.number().int(),
  }),
  CERTIFICATE_ISSUED: z.object({
    certificateId: z.string(),
    title: z.string(),
    verifyUrl: z.string(),
  }),
  APPLICATION_STATUS: z.object({
    applicationId: z.string(),
    jobTitle: z.string(),
    companyName: z.string(),
    status: z.string(),
  }),
  INTERVIEW_SCHEDULE: z.object({
    applicationId: z.string(),
    jobTitle: z.string(),
    scheduledAt: z.coerce.date(),
    mode: z.string(),
    meetingUrl: z.string().optional(),
  }),
} as const;

export type NotificationPayloadKey = keyof typeof notificationPayloadSchemas;
