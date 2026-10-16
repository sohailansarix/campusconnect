import type { Request, Response } from 'express';
import type { z } from 'zod';
import { eventSchemas, attendanceSchemas, commonSchemas } from '@campusconnect/shared';
import { roleHasPermission } from '@campusconnect/shared';
import * as eventService from './event.service.js';
import * as registrationService from './registration.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { ForbiddenError } from '../../utils/errors.js';
import { sendCsv, csvFilename, toCsv, formatDateTime } from '../../utils/csv.js';
import { prisma } from '../../config/prisma.js';
import { controllerHasReviewRights } from './event.permissions.js';

/**
 * Events controller.
 *
 * Discovery endpoints accept an optional principal so a signed-in student sees
 * their own registration state on each card, while an anonymous visitor gets the
 * same list without it.
 */

function viewerOf(req: Request) {
  const user = req.user;
  return {
    id: user?.id,
    collegeId: user?.collegeId ?? null,
    role: user?.role,
    isSuperAdmin: user?.role === 'SUPER_ADMIN',
    canReview: user ? controllerHasReviewRights(user.role) : false,
  };
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                  */
/* -------------------------------------------------------------------------- */

export async function list(req: Request, res: Response): Promise<void> {
  const viewer = viewerOf(req);
  const filters = req.query as z.infer<typeof eventSchemas.eventListQuerySchema>;

  const result = await eventService.list(filters as never, viewer);

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function calendar(req: Request, res: Response): Promise<void> {
  const viewer = viewerOf(req);
  const params = req.query as z.infer<typeof eventSchemas.eventCalendarQuerySchema>;

  const result = await eventService.calendar(params as never, viewer);
  res.json({ success: true, data: result });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const viewer = viewerOf(req);
  const { id } = req.params as { id: string };

  const event = await eventService.getBySlugOrId(id, viewer);
  res.json({ success: true, data: event });
}

/* -------------------------------------------------------------------------- */
/* Organiser writes                                                           */
/* -------------------------------------------------------------------------- */

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof eventSchemas.createEventSchema>;

  const event = await eventService.create(body as never, {
    id: user.id,
    collegeId: user.collegeId,
    role: user.role,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  }, auditContextOf(req));

  res.status(201).json({
    success: true,
    data: {
      ...event,
      message: 'Event saved as a draft. Submit it for review when you are ready.',
    },
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const body = req.body as z.infer<typeof eventSchemas.updateEventSchema>;

  const event = await eventService.update(id, body as never, {
    id: user.id,
    collegeId: user.collegeId,
    role: user.role,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  }, auditContextOf(req));

  res.json({ success: true, data: event });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const { note } = req.body as { note?: string };

  const result = await eventService.submitForApproval(id, note, {
    id: user.id,
    collegeId: user.collegeId,
    role: user.role,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  }, auditContextOf(req));

  res.json({
    success: true,
    data: {
      ...result,
      message: 'Submitted for review. You will be notified once it is approved.',
    },
  });
}

export async function decide(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const body = req.body as z.infer<typeof eventSchemas.eventApprovalSchema>;

  const result = await eventService.decide(id, body, {
    id: user.id,
    collegeId: user.collegeId,
    role: user.role,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  }, auditContextOf(req));

  res.json({ success: true, data: result });
}

export async function pendingApprovals(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as { page?: number; pageSize?: number };

  const result = await eventService.pendingApprovals(
    { collegeId: user.collegeId, role: user.role, isSuperAdmin: user.role === 'SUPER_ADMIN' },
    query,
  );

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const { reason } = req.body as { reason: string };

  const result = await eventService.cancel(id, reason, {
    id: user.id,
    collegeId: user.collegeId,
    role: user.role,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  }, auditContextOf(req));

  res.json({
    success: true,
    data: { ...result, message: `Event cancelled. ${result.notified} students notified.` },
  });
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export async function register(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const body = req.body as z.infer<typeof eventSchemas.registerForEventSchema>;

  const result = await registrationService.registerForEvent(
    id,
    user.id,
    body,
    auditContextOf(req),
  );

  res.status(201).json({ success: true, data: result });
}

export async function cancelRegistration(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { registrationId } = req.params as { registrationId: string };
  const body = req.body as { reason?: string };

  const result = await registrationService.cancelRegistration(
    registrationId,
    { id: user.id, role: user.role, collegeId: user.collegeId, isSuperAdmin: user.role === 'SUPER_ADMIN' },
    { reason: body?.reason },
    auditContextOf(req),
  );

  res.json({
    success: true,
    data: {
      ...result,
      message: result.promoted
        ? `Registration cancelled. ${result.promoted.name} was moved off the waitlist.`
        : 'Registration cancelled.',
    },
  });
}

export async function myRegistrations(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as z.infer<typeof eventSchemas.myRegistrationQuerySchema>;

  const result = await registrationService.listMyRegistrations(user.id, {
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    status: query.status,
    upcomingOnly: query.upcomingOnly,
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function eventRegistrations(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const query = req.query as z.infer<typeof eventSchemas.registrationListQuerySchema>;

  // Verify the caller manages this event before exposing the roster — it contains
  // student emails and phone numbers.
  await assertEventAccess(id, user, 'event:manage_attendance');

  const result = await registrationService.listEventRegistrations(id, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    search: query.search,
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function eventPass(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { registrationId } = req.params as { registrationId: string };

  const pass = await registrationService.getEventPass(registrationId, {
    id: user.id,
    role: user.role,
    collegeId: user.collegeId,
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  });

  res.json({ success: true, data: pass });
}

export async function manualAdd(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const { studentId } = req.body as { studentId: string };

  await assertEventAccess(id, user, 'event:manage_attendance');

  const result = await registrationService.addStudentManually(
    id,
    studentId,
    { id: user.id, collegeId: user.collegeId, role: user.role },
    auditContextOf(req),
  );

  res.status(201).json({ success: true, data: result });
}

/* -------------------------------------------------------------------------- */
/* Roster export                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Streams the attendee roster as CSV.
 *
 * Exported rather than paged, because the placement office's real workflow is a
 * spreadsheet. The audit row records the export — see `exportLimiter` for the
 * rate limit.
 */
export async function exportRegistrations(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;

  await assertEventAccess(id, user, 'event:view_analytics');

  const event = await prisma.event.findFirst({
    where: { id },
    select: { id: true, title: true, startAt: true },
  });

  const registrations = await prisma.eventRegistration.findMany({
    where: { eventId: id },
    orderBy: [{ status: 'asc' }, { registeredAt: 'asc' }],
    select: {
      status: true,
      passCode: true,
      registeredAt: true,
      waitlistPosition: true,
      student: {
        select: {
          fullName: true,
          email: true,
          phone: true,
          department: { select: { code: true } },
          studentProfile: { select: { rollNumber: true, graduationYear: true } },
        },
      },
      attendance: { select: { markedAt: true, method: true, revokedAt: true } },
      certificate: { select: { certificateId: true, status: true } },
    },
  });

  const csv = toCsv(registrations, [
    { header: 'Name', value: (r) => r.student.fullName },
    { header: 'Email', value: (r) => r.student.email },
    { header: 'Phone', value: (r) => r.student.phone },
    { header: 'Roll No', value: (r) => r.student.studentProfile?.rollNumber },
    { header: 'Department', value: (r) => r.student.department?.code },
    { header: 'Graduation Year', value: (r) => r.student.studentProfile?.graduationYear },
    { header: 'Registration Status', value: (r) => r.status },
    { header: 'Waitlist Position', value: (r) => r.waitlistPosition },
    { header: 'Registered At', value: (r) => formatDateTime(r.registeredAt) },
    {
      header: 'Attendance',
      value: (r) => (r.attendance && !r.attendance.revokedAt ? 'Present' : 'Absent'),
    },
    { header: 'Attendance Time', value: (r) => formatDateTime(r.attendance?.markedAt) },
    { header: 'Attendance Method', value: (r) => r.attendance?.method },
    { header: 'Pass Code', value: (r) => r.passCode },
    { header: 'Certificate ID', value: (r) => r.certificate?.certificateId },
    { header: 'Certificate Status', value: (r) => r.certificate?.status },
  ]);

  sendCsv(res, csv, csvFilename(`roster-${event?.title ?? id}`, event?.startAt, event?.startAt));
}

/* -------------------------------------------------------------------------- */
/* Shared guard                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Confirms the caller may act on an event's roster.
 *
 * Accepts: a platform admin, a college admin or coordinator in the same college,
 * the organiser, or the president of the organising club.
 */
async function assertEventAccess(
  eventId: string,
  user: { id: string; role: string; collegeId: string | null },
  permission: 'event:manage_attendance' | 'event:view_analytics',
): Promise<void> {
  const event = await prisma.event.findFirst({
    where: { id: eventId },
    select: { id: true, collegeId: true, organizerId: true, club: { select: { presidentId: true } } },
  });

  if (!event) throw new ForbiddenError('Event not found');

  if (user.role === 'SUPER_ADMIN') return;
  if (event.collegeId !== user.collegeId) {
    throw new ForbiddenError('That event belongs to another institution');
  }
  if (event.organizerId === user.id) return;
  if (event.club?.presidentId === user.id) return;
  if (roleHasPermission(user.role as never, permission)) return;

  throw new ForbiddenError('You do not manage this event');
}
