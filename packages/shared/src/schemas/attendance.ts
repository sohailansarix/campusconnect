import { z } from 'zod';
import { ATTENDANCE_METHODS } from '../constants.js';
import { listQuerySchema } from './common.js';

/**
 * Attendance is recorded by scanning the QR on a student's event pass.
 *
 * The scanned value is the *signed* pass token, never a raw registration id —
 * see `apps/api/src/utils/qr.ts`. That means the scanner endpoint only has to
 * verify a signature and look up the registration it names.
 */
export const scanPassSchema = z.object({
  /** Raw string decoded from the QR code. */
  token: z.string().min(10, 'That does not look like a CampusConnect pass').max(2000),
  /** Event the scanner is currently admitting for — guards against cross-event replay. */
  eventId: z.string().cuid(),
  method: z.enum(ATTENDANCE_METHODS).default('QR_SCAN'),
  /** Optional device/location breadcrumb for the audit log. */
  deviceLabel: z.string().trim().max(120).optional(),
  scannedAt: z.coerce.date().optional(),
});
export type ScanPassInput = z.infer<typeof scanPassSchema>;

/**
 * Manual fallback for when a student's phone is dead or the QR will not render.
 * Requires a reason so the audit trail explains why a scan was bypassed.
 */
export const manualCheckInSchema = z.object({
  eventId: z.string().cuid(),
  studentId: z.string().cuid(),
  reason: z.string().trim().min(5, 'Give a short reason').max(300),
});

export const bulkCheckInSchema = z.object({
  eventId: z.string().cuid(),
  studentIds: z.array(z.string().cuid()).min(1).max(500),
  reason: z.string().trim().min(5).max(300),
});

/** Undo — an accidental scan of the wrong person. */
export const revokeAttendanceSchema = z.object({
  reason: z.string().trim().min(5, 'Give a short reason').max(300),
});

export const attendanceListQuerySchema = listQuerySchema.extend({
  eventId: z.string().cuid().optional(),
  studentId: z.string().cuid().optional(),
  method: z.enum(ATTENDANCE_METHODS).optional(),
  /** Filter to students registered but not yet marked present. */
  pendingOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

/** Live counter polled by the scanner screen while doors are open. */
export const attendanceLiveQuerySchema = z.object({
  eventId: z.string().cuid(),
  /** Only count scans newer than this, so the "recent" rail stays accurate. */
  since: z.coerce.date().optional(),
});
