import type { Prisma } from '@prisma/client';
import { roleHasPermission } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TokenInvalidError,
  ValidationError,
  assertFound,
  assertSameCollege,
} from '../../utils/errors.js';
import { buildOrderBy, normalisePagination, paginated } from '../../utils/pagination.js';
import { sanitizeText } from '../../utils/sanitize.js';
import { auditAction, auditBulk, auditCreate, auditUpdate, type AuditContext } from '../../utils/audit.js';
import {
  assertPassMatchesEvent,
  extractTokenFromScan,
  passTokenFingerprint,
  verifyPassToken,
} from '../../utils/qr.js';
import { notify } from '../notifications/notification.service.js';

/**
 * Attendance service.
 *
 * Records who actually showed up, from three sources:
 *
 *  1. **QR scan** — the primary path. The scanned payload is a signed token bound
 *     to one registration *and* one event, so a screenshot of someone else's pass
 *     cannot be replayed and a pass for event A cannot be used at event B.
 *
 *  2. **Manual check-in** — the fallback when a phone is dead. Requires a reason,
 *     which is written to the audit log: an unexplained manual override is exactly
 *     what a certificate dispute turns on.
 *
 *  3. **Self check-in** — a student marking themselves present, for events where
 *     the organiser enables it. Recorded as SELF_CHECKIN so it is distinguishable
 *     from a verified scan in analytics.
 *
 * Every write is idempotent: scanning the same pass twice returns the existing
 * record rather than erroring, because a coordinator will absolutely scan twice.
 */

/* -------------------------------------------------------------------------- */
/* Scan                                                                       */
/* -------------------------------------------------------------------------- */

export type ScanResult = {
  outcome: 'ADMITTED' | 'ALREADY_MARKED' | 'WALK_IN_ADMITTED' | 'REJECTED';
  student: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
    rollNumber: string | null;
    departmentCode: string | null;
  } | null;
  registrationId: string | null;
  attendanceId: string | null;
  markedAt: Date | null;
  /** Populated when the student was not registered and was admitted as a walk-in. */
  walkIn: boolean;
  /** Human-readable outcome for the scanner screen. */
  message: string;
  /** Live counters, so the scanner does not poll separately. */
  counters: { admitted: number; expected: number; waitlisted: number };
};

export async function scanPass(
  input: { token: string; eventId: string; method: 'QR_SCAN' | 'SELF_CHECKIN'; deviceLabel?: string; scannedAt?: Date },
  scanner: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
  requestMeta: { ip?: string; userAgent?: string } = {},
): Promise<ScanResult> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: input.eventId, deletedAt: null },
      select: {
        id: true,
        title: true,
        collegeId: true,
        organizerId: true,
        status: true,
        startAt: true,
        endAt: true,
        capacity: true,
        club: { select: { presidentId: true } },
      },
    }),
    'Event',
  );

  await assertScannerMayAdmit(event, scanner);

  // Decode and verify the signed payload. This throws TokenInvalidError with a
  // coordinator-readable reason when the pass is expired, tampered with or for
  // another event.
  const rawToken = extractTokenFromScan(input.token);
  const payload = verifyPassToken(rawToken);
  assertPassMatchesEvent(payload.e, input.eventId);

  const registration = await prisma.eventRegistration.findUnique({
    where: { id: payload.r },
    select: {
      id: true,
      eventId: true,
      studentId: true,
      status: true,
      collegeId: true,
      student: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          email: true,
          department: { select: { code: true } },
          studentProfile: { select: { rollNumber: true } },
        },
      },
      attendance: { select: { id: true, markedAt: true, revokedAt: true } },
    },
  });

  if (!registration) throw new NotFoundError('Registration');

  // The token names the event, and the token signature covers the event id, so a
  // mismatch here would mean the database row moved — treat it as invalid.
  if (registration.eventId !== input.eventId) {
    throw new TokenInvalidError('This pass does not belong to this event');
  }

  // --- Already marked -------------------------------------------------------
  if (registration.attendance && registration.attendance.revokedAt === null) {
    return {
      outcome: 'ALREADY_MARKED',
      student: shapeStudent(registration.student),
      registrationId: registration.id,
      attendanceId: registration.attendance.id,
      markedAt: registration.attendance.markedAt,
      walkIn: false,
      message: `${registration.student.fullName} was already marked present at ${registration.attendance.markedAt.toLocaleTimeString('en-IN')}.`,
      counters: await liveCounters(input.eventId),
    };
  }

  // --- Status gate ----------------------------------------------------------
  /*
   * A waitlisted student has a pass in the app but no seat. Admitting them would
   * silently oversubscribe the room, so this is an explicit rejection with a
   * message directing them to the help desk — where an organiser can promote them
   * manually if space allows.
   */
  if (registration.status === 'WAITLISTED') {
    return {
      outcome: 'REJECTED',
      student: shapeStudent(registration.student),
      registrationId: registration.id,
      attendanceId: null,
      markedAt: null,
      walkIn: false,
      message: `${registration.student.fullName} is on the waitlist, not confirmed. Send them to the help desk.`,
      counters: await liveCounters(input.eventId),
    };
  }

  if (registration.status === 'CANCELLED') {
    return {
      outcome: 'REJECTED',
      student: shapeStudent(registration.student),
      registrationId: registration.id,
      attendanceId: null,
      markedAt: null,
      walkIn: false,
      message: `${registration.student.fullName} cancelled their registration.`,
      counters: await liveCounters(input.eventId),
    };
  }

  if (registration.status === 'NO_SHOW') {
    // A no-show is only set by the sweep after the event ends, so this means a
    // late scan against a completed event. Allow it — the organiser is the
    // authority on who attended.
    logger.info('Late attendance scan against a no-show registration', {
      registrationId: registration.id,
      eventId: input.eventId,
    });
  }

  const markedAt = input.scannedAt ?? new Date();

  const attendance = await prisma.$transaction(async (tx) => {
    // Upsert rather than create: a revoked row may already exist for this
    // registration, and the unique constraint is on (eventId, studentId).
    const row = await tx.attendance.upsert({
      where: { registrationId: registration.id },
      create: {
        eventId: input.eventId,
        studentId: registration.studentId,
        registrationId: registration.id,
        collegeId: event.collegeId,
        method: input.method,
        markedAt,
        scannedById: scanner.id,
        deviceLabel: input.deviceLabel ?? null,
        scannedTokenHash: passTokenFingerprint(rawToken),
        ipAddress: requestMeta.ip ?? null,
      },
      update: {
        // Re-admitting after a revocation: clear the revocation rather than
        // creating a second row.
        method: input.method,
        markedAt,
        scannedById: scanner.id,
        deviceLabel: input.deviceLabel ?? null,
        scannedTokenHash: passTokenFingerprint(rawToken),
        revokedAt: null,
        revokedById: null,
        revokeReason: null,
      },
      select: { id: true, markedAt: true },
    });

    await tx.eventRegistration.update({
      where: { id: registration.id },
      data: { status: 'ATTENDED' },
    });

    // Only count the transition into attendance, never a re-scan.
    if (!registration.attendance) {
      await tx.event.update({
        where: { id: input.eventId },
        data: { attendanceCount: { increment: 1 } },
      });
    }

    return row;
  });

  auditAction(context, 'SCAN', 'Attendance', attendance.id, {
    eventId: input.eventId,
    registrationId: registration.id,
    studentId: registration.studentId,
    method: input.method,
    deviceLabel: input.deviceLabel,
  });

  return {
    outcome: 'ADMITTED',
    student: shapeStudent(registration.student),
    registrationId: registration.id,
    attendanceId: attendance.id,
    markedAt: attendance.markedAt,
    walkIn: false,
    message: `${registration.student.fullName} admitted.`,
    counters: await liveCounters(input.eventId),
  };
}

function shapeStudent(student: {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  department: { code: string } | null;
  studentProfile: { rollNumber: string | null } | null;
}) {
  return {
    id: student.id,
    fullName: student.fullName,
    avatarUrl: student.avatarUrl,
    rollNumber: student.studentProfile?.rollNumber ?? null,
    departmentCode: student.department?.code ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Manual check-in                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Marks a student present without a scan.
 *
 * Requires a reason (validated upstream) and writes it to both the attendance row
 * and the audit log. This is the path a hostile or careless organiser would abuse
 * to issue certificates to people who never attended, so the reason and the acting
 * user are both permanently recorded.
 */
export async function manualCheckIn(
  input: { eventId: string; studentId: string; reason: string },
  scanner: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<ScanResult> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: input.eventId, deletedAt: null },
      select: {
        id: true,
        title: true,
        collegeId: true,
        organizerId: true,
        status: true,
        capacity: true,
        club: { select: { presidentId: true } },
      },
    }),
    'Event',
  );

  await assertScannerMayAdmit(event, scanner);

  const registration = await prisma.eventRegistration.findUnique({
    where: { eventId_studentId: { eventId: input.eventId, studentId: input.studentId } },
    select: {
      id: true,
      status: true,
      studentId: true,
      student: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          department: { select: { code: true } },
          studentProfile: { select: { rollNumber: true } },
        },
      },
      attendance: { select: { id: true, markedAt: true, revokedAt: true } },
    },
  });

  if (!registration) {
    throw new NotFoundError(
      'Registration — add the student to the event first, then mark them present',
    );
  }

  if (registration.attendance && registration.attendance.revokedAt === null) {
    return {
      outcome: 'ALREADY_MARKED',
      student: shapeStudent(registration.student),
      registrationId: registration.id,
      attendanceId: registration.attendance.id,
      markedAt: registration.attendance.markedAt,
      walkIn: false,
      message: `${registration.student.fullName} is already marked present.`,
      counters: await liveCounters(input.eventId),
    };
  }

  const attendance = await prisma.$transaction(async (tx) => {
    const row = await tx.attendance.upsert({
      where: { registrationId: registration.id },
      create: {
        eventId: input.eventId,
        studentId: input.studentId,
        registrationId: registration.id,
        collegeId: event.collegeId,
        method: 'MANUAL',
        markedAt: new Date(),
        scannedById: scanner.id,
        reason: sanitizeText(input.reason, 300),
      },
      update: {
        method: 'MANUAL',
        markedAt: new Date(),
        scannedById: scanner.id,
        reason: sanitizeText(input.reason, 300),
        revokedAt: null,
        revokedById: null,
        revokeReason: null,
      },
      select: { id: true, markedAt: true },
    });

    // A manual check-in also confirms a waitlisted student, because the organiser
    // is deliberately making room for them.
    await tx.eventRegistration.update({
      where: { id: registration.id },
      data: {
        status: 'ATTENDED',
        ...(registration.status === 'WAITLISTED'
          ? { waitlistPosition: null, promotedAt: new Date() }
          : {}),
      },
    });

    if (registration.status === 'WAITLISTED') {
      await tx.event.update({
        where: { id: input.eventId },
        data: { waitlistCount: { decrement: 1 }, registrationCount: { increment: 1 } },
      });
    }

    if (!registration.attendance) {
      await tx.event.update({
        where: { id: input.eventId },
        data: { attendanceCount: { increment: 1 } },
      });
    }

    return row;
  });

  auditAction(context, 'SCAN', 'Attendance', attendance.id, {
    manual: true,
    reason: input.reason,
    eventId: input.eventId,
    studentId: input.studentId,
  });

  logger.warn('Manual attendance check-in recorded', {
    eventId: input.eventId,
    studentId: input.studentId,
    byUserId: scanner.id,
    reason: input.reason,
  });

  return {
    outcome: 'ADMITTED',
    student: shapeStudent(registration.student),
    registrationId: registration.id,
    attendanceId: attendance.id,
    markedAt: attendance.markedAt,
    walkIn: false,
    message: `${registration.student.fullName} marked present manually.`,
    counters: await liveCounters(input.eventId),
  };
}

/** Bulk manual check-in for a whole list — used for offline registration desks. */
export async function bulkManualCheckIn(
  input: { eventId: string; studentIds: string[]; reason: string },
  scanner: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<{ marked: number; skipped: number; notRegistered: string[] }> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: input.eventId, deletedAt: null },
      select: { id: true, collegeId: true, organizerId: true, club: { select: { presidentId: true } }, status: true },
    }),
    'Event',
  );

  await assertScannerMayAdmit(event, scanner);

  const registrations = await prisma.eventRegistration.findMany({
    where: { eventId: input.eventId, studentId: { in: input.studentIds } },
    select: { id: true, studentId: true, status: true, attendance: { select: { id: true, revokedAt: true } } },
  });

  const registrationByStudent = new Map(registrations.map((r) => [r.studentId, r]));
  const notRegistered = input.studentIds.filter((id) => !registrationByStudent.has(id));

  let marked = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const registration of registrations) {
      // Already present and not revoked — nothing to do.
      if (registration.attendance && registration.attendance.revokedAt === null) {
        skipped += 1;
        continue;
      }

      await tx.attendance.upsert({
        where: { registrationId: registration.id },
        create: {
          eventId: input.eventId,
          studentId: registration.studentId,
          registrationId: registration.id,
          collegeId: event.collegeId,
          method: 'MANUAL',
          markedAt: new Date(),
          scannedById: scanner.id,
          reason: sanitizeText(input.reason, 300),
        },
        update: {
          method: 'MANUAL',
          markedAt: new Date(),
          scannedById: scanner.id,
          reason: sanitizeText(input.reason, 300),
          revokedAt: null,
        },
      });

      await tx.eventRegistration.update({
        where: { id: registration.id },
        data: { status: 'ATTENDED' },
      });

      marked += 1;
    }

    if (marked > 0) {
      await tx.event.update({
        where: { id: input.eventId },
        data: { attendanceCount: { increment: marked } },
      });
    }
  });

  auditBulk(context, 'SCAN', 'Attendance', input.studentIds, {
    bulkManual: true,
    reason: input.reason,
    marked,
    skipped,
  });

  return { marked, skipped, notRegistered };
}

/** Undoes a scan. The row is kept with a reason so the history is complete. */
export async function revokeAttendance(
  attendanceId: string,
  reason: string,
  actor: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<void> {
  const attendance = assertFound(
    await prisma.attendance.findUnique({
      where: { id: attendanceId },
      select: {
        id: true,
        eventId: true,
        studentId: true,
        registrationId: true,
        revokedAt: true,
        event: { select: { collegeId: true } },
      },
    }),
    'Attendance record',
  );

  if (attendance.revokedAt !== null) {
    throw new ConflictError('This attendance record has already been revoked');
  }

  assertSameCollege(attendance.event.collegeId, actor.collegeId);

  await prisma.$transaction([
    prisma.attendance.update({
      where: { id: attendanceId },
      data: { revokedAt: new Date(), revokedById: actor.id, revokeReason: sanitizeText(reason, 300) },
    }),
    prisma.eventRegistration.update({
      where: { id: attendance.registrationId },
      data: { status: 'NO_SHOW' },
    }),
    prisma.event.updateMany({
      where: { id: attendance.eventId, attendanceCount: { gt: 0 } },
      data: { attendanceCount: { decrement: 1 } },
    }),
  ]);

  auditAction(context, 'REVOKE', 'Attendance', attendanceId, {
    reason,
    eventId: attendance.eventId,
    studentId: attendance.studentId,
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Live counters for the scanner screen. */
export async function liveCounters(eventId: string): Promise<{
  admitted: number;
  expected: number;
  waitlisted: number;
}> {
  const [admitted, expected, waitlisted] = await Promise.all([
    prisma.attendance.count({ where: { eventId, revokedAt: null } }),
    prisma.eventRegistration.count({
      where: { eventId, status: { in: ['CONFIRMED', 'ATTENDED'] } },
    }),
    prisma.eventRegistration.count({ where: { eventId, status: 'WAITLISTED' } }),
  ]);

  return { admitted, expected, waitlisted };
}

/** Detailed live view including a recent-scan rail. */
export async function liveFeed(
  eventId: string,
  options: { since?: Date },
) {
  const [counters, recent, notYetPresent] = await Promise.all([
    liveCounters(eventId),
    prisma.attendance.findMany({
      where: {
        eventId,
        ...(options.since ? { markedAt: { gte: options.since } } : {}),
      },
      orderBy: { markedAt: 'desc' },
      take: 25,
      select: {
        id: true,
        method: true,
        markedAt: true,
        revokedAt: true,
        student: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            department: { select: { code: true } },
            studentProfile: { select: { rollNumber: true } },
          },
        },
        scannedBy: { select: { id: true, fullName: true } },
      },
    }),
    // Students expected but not yet admitted — what the door team works from.
    prisma.eventRegistration.findMany({
      where: {
        eventId,
        status: 'CONFIRMED',
        attendance: null,
      },
      orderBy: { registeredAt: 'asc' },
      take: 50,
      select: {
        id: true,
        passCode: true,
        student: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            department: { select: { code: true } },
            studentProfile: { select: { rollNumber: true } },
          },
        },
      },
    }),
  ]);

  return {
    counters,
    attendanceRate: counters.expected > 0 ? Math.round((counters.admitted / counters.expected) * 100) : 0,
    recent,
    notYetPresent,
  };
}

/** Attendance list for the organiser, with filters. */
export async function list(
  filters: {
    page?: number;
    pageSize?: number;
    eventId?: string;
    studentId?: string;
    method?: string;
    pendingOnly?: boolean;
  },
  scope: { collegeId: string | null; isSuperAdmin: boolean },
) {
  const pagination = normalisePagination(filters);

  // `pendingOnly` inverts the query — it lists registrations without attendance.
  if (filters.pendingOnly && filters.eventId) {
    const where: Prisma.EventRegistrationWhereInput = {
      eventId: filters.eventId,
      status: { in: ['CONFIRMED', 'ATTENDED'] },
      attendance: null,
    };

    const [items, total] = await Promise.all([
      prisma.eventRegistration.findMany({
        where,
        orderBy: { registeredAt: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          passCode: true,
          status: true,
          student: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              email: true,
              department: { select: { code: true } },
              studentProfile: { select: { rollNumber: true } },
            },
          },
        },
      }),
      prisma.eventRegistration.count({ where }),
    ]);

    return paginated(items, total, pagination);
  }

  const where: Prisma.AttendanceWhereInput = {
    ...(scope.isSuperAdmin ? {} : { collegeId: scope.collegeId }),
    ...(filters.eventId ? { eventId: filters.eventId } : {}),
    ...(filters.studentId ? { studentId: filters.studentId } : {}),
    ...(filters.method ? { method: filters.method as never } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: buildOrderBy(filters.sortBy, filters.sortOrder, ['markedAt'] as const, 'markedAt', 'desc'),
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        method: true,
        markedAt: true,
        revokedAt: true,
        reason: true,
        deviceLabel: true,
        event: { select: { id: true, title: true, startAt: true, slug: true } },
        student: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            username: true,
            email: true,
            department: { select: { code: true } },
            studentProfile: { select: { rollNumber: true } },
          },
        },
        scannedBy: { select: { id: true, fullName: true, role: true } },
      },
    }),
    prisma.attendance.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/** Attendance history for one student — powers the participation timeline. */
export async function studentHistory(
  studentId: string,
  filters: { page?: number; pageSize?: number },
) {
  const pagination = normalisePagination(filters);

  const where = { studentId, revokedAt: null };

  const [items, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: { markedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        method: true,
        markedAt: true,
        event: {
          select: {
            id: true,
            slug: true,
            title: true,
            category: true,
            mode: true,
            startAt: true,
            endAt: true,
            venue: true,
            bannerUrl: true,
            club: { select: { id: true, name: true, logoUrl: true } },
          },
        },
        registration: {
          select: { certificate: { select: { certificateId: true, title: true, status: true } } },
        },
      },
    }),
    prisma.attendance.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/* -------------------------------------------------------------------------- */
/* Access control                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Confirms the caller may admit students to this event.
 *
 * A trainer or coordinator with `event:manage_attendance` may scan at any event in
 * their college; a club president may scan only at their club's events. The
 * organiser themselves may always scan.
 */
async function assertScannerMayAdmit(
  event: { id: string; collegeId: string; organizerId: string; club: { presidentId: string | null } | null },
  scanner: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
): Promise<void> {
  if (scanner.isSuperAdmin) return;

  if (event.collegeId !== scanner.collegeId) {
    throw new ForbiddenError('That event belongs to another institution');
  }

  if (event.organizerId === scanner.id) return;
  if (event.club?.presidentId === scanner.id) return;
  if (roleHasPermission(scanner.role as never, 'event:manage_attendance')) return;

  throw new ForbiddenError('You do not have permission to record attendance for this event');
}

export { assertScannerMayAdmit };
