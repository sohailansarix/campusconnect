import type { Request, Response } from 'express';
import type { z } from 'zod';
import { attendanceSchemas } from '@campusconnect/shared';
import * as attendanceService from './attendance.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { sendCsv, csvFilename, toCsv, formatDateTime } from '../../utils/csv.js';
import { prisma } from '../../config/prisma.js';
import { roleHasPermission } from '@campusconnect/shared';

function scannerOf(req: Request) {
  const user = requireUser(req);
  return {
    id: user.id,
    role: user.role,
    collegeId: user.collegeId,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  };
}

/** Scans a pass and admits the student. */
export async function scan(req: Request, res: Response): Promise<void> {
  const scanner = scannerOf(req);
  const body = req.body as z.infer<typeof attendanceSchemas.scanPassSchema>;

  const result = await attendanceService.scanPass(
    {
      token: body.token,
      eventId: body.eventId,
      method: body.method === 'SELF_CHECKIN' ? 'SELF_CHECKIN' : 'QR_SCAN',
      deviceLabel: body.deviceLabel,
      scannedAt: body.scannedAt,
    },
    scanner,
    auditContextOf(req),
    { ip: req.ip, userAgent: req.headers['user-agent'] },
  );

  /*
   * A rejection is a successful HTTP response, not an error. The scanner screen
   * must render "this pass is for a different event" or "on the waitlist" as a
   * distinct visual state with the student's name, which a 4xx would turn into a
   * generic error toast.
   */
  res.status(result.outcome === 'REJECTED' ? 200 : 201).json({ success: true, data: result });
}

export async function manualCheckIn(req: Request, res: Response): Promise<void> {
  const scanner = scannerOf(req);
  const body = req.body as z.infer<typeof attendanceSchemas.manualCheckInSchema>;

  const result = await attendanceService.manualCheckIn(body, scanner, auditContextOf(req));
  res.status(201).json({ success: true, data: result });
}

export async function bulkCheckIn(req: Request, res: Response): Promise<void> {
  const scanner = scannerOf(req);
  const body = req.body as z.infer<typeof attendanceSchemas.bulkCheckInSchema>;

  const result = await attendanceService.bulkManualCheckIn(body, scanner, auditContextOf(req));

  res.status(201).json({
    success: true,
    data: {
      ...result,
      message: `${result.marked} marked present${result.skipped > 0 ? `, ${result.skipped} already present` : ''}${
        result.notRegistered.length > 0 ? `, ${result.notRegistered.length} not registered` : ''
      }.`,
    },
  });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const scanner = scannerOf(req);
  const { id } = req.params as { id: string };
  const body = req.body as z.infer<typeof attendanceSchemas.revokeAttendanceSchema>;

  await attendanceService.revokeAttendance(id, body.reason, scanner, auditContextOf(req));
  res.json({ success: true, data: { revoked: true } });
}

export async function live(req: Request, res: Response): Promise<void> {
  const scanner = scannerOf(req);
  const query = req.query as z.infer<typeof attendanceSchemas.attendanceLiveQuerySchema>;

  const result = await attendanceService.liveFeed(query.eventId, { since: query.since });
  res.json({ success: true, data: result });
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as z.infer<typeof attendanceSchemas.attendanceListQuerySchema>;

  const result = await attendanceService.list(query, {
    collegeId: user.collegeId,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

/** The caller's own participation timeline. */
export async function myHistory(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as { page?: number; pageSize?: number };

  const result = await attendanceService.studentHistory(user.id, query);
  res.json({ success: true, data: result.items, meta: result.meta });
}

/**
 * Attendance report for an event, or for every event the caller manages.
 *
 * Exported as CSV because the placement office's real workflow is a spreadsheet —
 * see the note on `exportRegistrations`.
 */
export async function exportReport(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { eventId } = req.query as { eventId?: string };

  const where = {
    revokedAt: null,
    ...(eventId
      ? { eventId }
      : {
          // Without an event filter, scope to the caller's college and to events
          // they are entitled to report on.
          ...(user.role === 'SUPER_ADMIN' ? {} : { collegeId: user.collegeId }),
        }),
  };

  const attendances = await prisma.attendance.findMany({
    where,
    orderBy: { markedAt: 'desc' },
    take: 20_000,
    select: {
      method: true,
      markedAt: true,
      deviceLabel: true,
      reason: true,
      event: { select: { title: true, startAt: true, category: true } },
      student: {
        select: {
          fullName: true,
          email: true,
          department: { select: { code: true } },
          studentProfile: { select: { rollNumber: true, graduationYear: true } },
        },
      },
      scannedBy: { select: { fullName: true, role: true } },
    },
  });

  const csv = toCsv(attendances, [
    { header: 'Event', value: (a) => a.event.title },
    { header: 'Event Date', value: (a) => formatDateTime(a.event.startAt) },
    { header: 'Category', value: (a) => a.event.category },
    { header: 'Student', value: (a) => a.student.fullName },
    { header: 'Email', value: (a) => a.student.email },
    { header: 'Roll No', value: (a) => a.student.studentProfile?.rollNumber },
    { header: 'Department', value: (a) => a.student.department?.code },
    { header: 'Graduation Year', value: (a) => a.student.studentProfile?.graduationYear },
    { header: 'Method', value: (a) => a.method },
    { header: 'Marked At', value: (a) => formatDateTime(a.markedAt) },
    { header: 'Marked By', value: (a) => a.scannedBy?.fullName },
    { header: 'Override Reason', value: (a) => a.reason },
    { header: 'Device', value: (a) => a.deviceLabel },
  ]);

  sendCsv(res, csv, csvFilename('attendance-report'));
}
