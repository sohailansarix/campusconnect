import { z } from 'zod';
import { CERTIFICATE_STATUSES, CERTIFICATE_TYPES } from '../constants.js';
import { listQuerySchema, urlOrPathSchema } from './common.js';

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

/** Placeholders substituted at issue time. Kept deliberately small. */
export const CERTIFICATE_PLACEHOLDERS = [
  '{{studentName}}',
  '{{eventTitle}}',
  '{{eventDates}}',
  '{{collegeName}}',
  '{{departmentName}}',
  '{{certificateId}}',
  '{{issuedOn}}',
  '{{position}}',
  '{{organizerName}}',
] as const;

export const createCertificateTemplateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  type: z.enum(CERTIFICATE_TYPES),
  /** Body copy with {{placeholders}}. Validated below. */
  bodyTemplate: z.string().trim().min(20).max(4000),
  backgroundUrl: urlOrPathSchema.nullable().optional(),
  signatureLabel: z.string().trim().max(120).optional(),
  signatoryName: z.string().trim().max(120).optional(),
  signatoryTitle: z.string().trim().max(120).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a 6-digit hex colour')
    .default('#2563EB'),
  isActive: z.boolean().default(true),
});

export const updateCertificateTemplateSchema = createCertificateTemplateSchema.partial();

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

/** Issue certificates for every attendee of an event. Idempotent per student. */
export const bulkIssueForEventSchema = z.object({
  eventId: z.string().cuid(),
  /** Restrict to specific students; omit to issue for all attendees. */
  studentIds: z.array(z.string().cuid()).max(2000).optional(),
  /** Applies to every certificate in the batch. */
  position: z.string().trim().max(60).optional(),
  /** Queue an email per certificate. */
  sendEmail: z.boolean().default(true),
  /** Re-issue: revokes the previous certificate and creates a new record. */
  reissue: z.boolean().default(false),
});
export type BulkIssueForEventInput = z.infer<typeof bulkIssueForEventSchema>;

export const issueSingleCertificateSchema = z.object({
  studentId: z.string().cuid(),
  type: z.enum(CERTIFICATE_TYPES),
  eventId: z.string().cuid().optional(),
  courseId: z.string().cuid().optional(),
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().max(1000).optional(),
  position: z.string().trim().max(60).optional(),
  issuedOn: z.coerce.date().optional(),
});

export const revokeCertificateSchema = z.object({
  reason: z.string().trim().min(10, 'Explain why this certificate is being revoked').max(500),
});

export const certificateListQuerySchema = listQuerySchema.extend({
  type: z.enum(CERTIFICATE_TYPES).optional(),
  status: z.enum(CERTIFICATE_STATUSES).optional(),
  eventId: z.string().cuid().optional(),
  studentId: z.string().cuid().optional(),
  collegeId: z.string().cuid().optional(),
  /** Restrict to the caller's own certificates. */
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* Public verification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Public, unauthenticated lookup. The certificate ID is the only input, and the
 * response deliberately exposes nothing beyond issuer/recipient/event/date —
 * see `CertificateService.verifyPublic` for the field-by-field allowlist.
 */
export const verifyCertificateParamsSchema = z.object({
  certificateId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}-[0-9]{4}-[0-9A-Z]{4,10}$/, 'Certificate IDs look like CC-2026-A7F3K2'),
});
