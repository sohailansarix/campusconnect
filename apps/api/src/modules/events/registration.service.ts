import type { EventCategory, EventMode, EventStatus } from '@prisma/client';
import { roleHasPermission } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  AlreadyRegisteredError,
  CapacityFullError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertFound,
} from '../../utils/errors.js';
import { generatePassCode } from '../../utils/ids.js';
import { buildOrderBy, normalisePagination, paginated } from '../../utils/pagination.js';
import { auditAction, auditBulk, auditCreate } from '../../utils/audit.js';
import type { AuditContext } from '../../utils/audit.js';
import { notify } from '../../services/notifications/notification.service.js';
import * as templates from '../../services/mailer/templates.js';
import { env } from '../../config/env.js';
import { signPassToken, generateQrDataUrl, buildPassQrContent } from '../../utils/qr.js';
import { isRegistrationOpen } from './event.service.js';

/**
 * Event registration service.
 *
 * This is the most concurrency-sensitive code in Phase 1. The capacity check and
 * the insert must be atomic, or two students clicking "Register" on the last seat
 * at the same moment both succeed and the event is oversubscribed.
 *
 * The approach: `registerForEvent` runs inside a transaction that takes a row lock
 * on the event via `SELECT ... FOR UPDATE` (Prisma's `$queryRaw`), then re-reads
 * the count and decides between CONFIRMED and WAITLISTED. A unique constraint on
 * `(eventId, studentId)` provides the second line of defence against double
 * submission.
 *
 * Waitlisting:
 *   * Full + waitlistEnabled  → WAITLISTED at position N
 *   * Full + no waitlist      → CapacityFullError
 *   * Cancellation by a CONFIRMED student promotes the first WAITLISTED student
 *     and emails them.
 */

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export type RegisterInput = {
  responses?: Record<string, string>;
  paymentReference?: string;
  acceptWaitlist: boolean;
};

export type RegisterResult = {
  registrationId: string;
  status: 'CONFIRMED' | 'WAITLISTED' | 'PENDING';
  waitlistPosition: number | null;
  passCode: string | null;
  seatsRemaining: number | null;
  message: string;
};

export async function registerForEvent(
  eventId: string,
  studentId: string,
  input: RegisterInput,
  context: AuditContext,
): Promise<RegisterResult> {
  const student = assertFound(
    await prisma.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        collegeId: true,
        departmentId: true,
        status: true,
        studentProfile: { select: { graduationYear: true, id: true } },
      },
    }),
    'Student',
  );

  if (student.status !== 'ACTIVE') {
    throw new ForbiddenError('Your account is not active — contact your college administrator');
  }

  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        collegeId: true,
        clubId: true,
        departmentId: true,
        organizerId: true,
        startAt: true,
        endAt: true,
        venue: true,
        mode: true,
        meetingUrl: true,
        capacity: true,
        waitlistEnabled: true,
        fee: true,
        currency: true,
        registrationDeadline: true,
        registrationCount: true,
        eligibleYears: true,
        certificateEnabled: true,
      },
    }),
    'Event',
  );

  // --- Eligibility ----------------------------------------------------------
  if (event.collegeId !== student.collegeId) {
    throw new ForbiddenError('You can only register for events at your own college');
  }

  if (!isRegistrationOpen(event)) {
    if (event.status !== 'PUBLISHED') {
      throw new ConflictError('Registration for this event is not open');
    }
    if (event.startAt <= new Date()) {
      throw new ConflictError('This event has already started');
    }
    throw new ConflictError('Registration for this event has closed');
  }

  // Year-of-study restriction. An empty list means open to all years.
  if (event.eligibleYears.length > 0 && student.studentProfile?.graduationYear) {
    // Derive the current year of study from the graduation year.
    const yearsToGraduation = student.studentProfile.graduationYear - new Date().getFullYear();
    const yearOfStudy = Math.max(1, 5 - yearsToGraduation);

    if (!event.eligibleYears.includes(yearOfStudy)) {
      throw new ForbiddenError(
        `This event is open to year ${event.eligibleYears.join(', ')} students only`,
      );
    }
  }

  // Department-scoped events.
  if (event.departmentId && event.departmentId !== student.departmentId) {
    throw new ForbiddenError('This event is limited to a specific department');
  }

  const existing = await prisma.eventRegistration.findUnique({
    where: { eventId_studentId: { eventId, studentId } },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === 'CANCELLED') {
      // Re-registering after cancelling: reuse the row so the unique constraint
      // holds, and put them at the back of the queue.
      return reRegister(event, student, existing.id, input, context);
    }
    throw new AlreadyRegisteredError(
      existing.status === 'WAITLISTED'
        ? `You are already on the waitlist at position ${await waitlistPositionOf(existing.id)}`
        : 'You are already registered for this event',
    );
  }

  if (event.fee > 0 && !input.paymentReference) {
    throw new ValidationError('This is a paid event and no payment reference was supplied', [
      { path: 'paymentReference', message: 'Required for paid events' },
    ]);
  }

  const passCode = generatePassCode();

  /**
   * Capacity and insert in one transaction against a locked event row.
   *
   * Two processes racing for the last seat serialise here: the second waits for
   * the first to commit, then re-reads `registrationCount` and correctly sees the
   * event as full. Without the lock, both would read the pre-insert count.
   */
  const result = await prisma.$transaction(async (tx) => {
    // `FOR UPDATE` serialises concurrent registrations for this event only.
    const [locked] = await tx.$queryRaw<
      { id: string; capacity: number; waitlist_enabled: boolean }[]
    >`SELECT id, capacity, waitlist_enabled FROM events WHERE id = ${eventId} FOR UPDATE`;

    if (!locked) throw new NotFoundError('Event');

    // The authoritative count is taken inside the lock, not from the earlier read.
    const confirmedCount = await tx.eventRegistration.count({
      where: { eventId, status: { in: ['CONFIRMED', 'ATTENDED'] } },
    });

    const hasSeats = locked.capacity === 0 || confirmedCount < locked.capacity;

    if (!hasSeats && !locked.waitlist_enabled) {
      throw new CapacityFullError('This event is full and has no waitlist');
    }

    if (!hasSeats && !input.acceptWaitlist) {
      throw new CapacityFullError('This event is full. Join the waitlist to be notified if a seat opens.');
    }

    let status: 'CONFIRMED' | 'WAITLISTED' = hasSeats ? 'CONFIRMED' : 'WAITLISTED';
    let waitlistPosition: number | null = null;

    if (status === 'WAITLISTED') {
      const waitlistedCount = await tx.eventRegistration.count({
        where: { eventId, status: 'WAITLISTED' },
      });
      waitlistPosition = waitlistedCount + 1;
    }

    // Free events confirm immediately. Paid events with a payment reference are
    // confirmed because the provider already captured the money.
    if (event.fee > 0 && !input.paymentReference) status = 'PENDING';

    const registration = await tx.eventRegistration.create({
      data: {
        eventId,
        studentId,
        collegeId: event.collegeId,
        status,
        waitlistPosition,
        passCode,
        responses: (input.responses ?? undefined) as never,
        paymentReference: input.paymentReference ?? null,
        amountPaid: input.paymentReference ? event.fee : 0,
        registeredAt: new Date(),
      },
      select: { id: true, status: true, waitlistPosition: true, passCode: true },
    });

    // Counters are maintained in the same transaction so a list page never has to
    // aggregate.
    await tx.event.update({
      where: { id: eventId },
      data: {
        registrationCount: { increment: status === 'CONFIRMED' ? 1 : 0 },
        waitlistCount: { increment: status === 'WAITLISTED' ? 1 : 0 },
      },
    });

    const seatsRemaining =
      locked.capacity === 0 ? null : Math.max(0, locked.capacity - confirmedCount - (status === 'CONFIRMED' ? 1 : 0));

    return { registration, seatsRemaining };
  });

  // --- Post-commit side effects ---------------------------------------------
  const passUrl = `${env.WEB_URL}/dashboard/events/pass/${result.registration.id}`;

  if (result.registration.status === 'CONFIRMED') {
    await notify({
      userId: studentId,
      type: 'EVENT_REGISTRATION',
      title: `You're registered for ${event.title}`,
      body: `${event.title} starts ${event.startAt.toLocaleString('en-IN')}. Your QR pass is ready.`,
      actionUrl: `/dashboard/events/pass/${result.registration.id}`,
      dedupeKey: `event-registered-${result.registration.id}`,
      email: () =>
        templates.eventRegistrationEmail({
          studentName: student.fullName,
          eventTitle: event.title,
          startAt: event.startAt,
          venue: event.venue,
          mode: event.mode,
          passUrl,
          organizerName: 'the organising team',
        }),
    });
  } else if (result.registration.status === 'WAITLISTED') {
    await notify({
      userId: studentId,
      type: 'EVENT_REGISTRATION',
      title: `You're on the waitlist for ${event.title}`,
      body: `Position ${result.registration.waitlistPosition}. We'll email you if a seat opens up.`,
      actionUrl: `/events/${event.slug}`,
      dedupeKey: `event-waitlisted-${result.registration.id}`,
      email: () =>
        templates.waitlistJoinedEmail({
          studentName: student.fullName,
          eventTitle: event.title,
          position: result.registration.waitlistPosition ?? 1,
          eventUrl: `${env.WEB_URL}/events/${event.slug}`,
        }),
    });
  }

  auditCreate(context, 'EventRegistration', result.registration.id, {
    eventId,
    status: result.registration.status,
    waitlistPosition: result.registration.waitlistPosition,
  });

  logger.info('Event registration created', {
    registrationId: result.registration.id,
    eventId,
    status: result.registration.status,
    waitlisted: result.registration.status === 'WAITLISTED',
  });

  return {
    registrationId: result.registration.id,
    status: result.registration.status,
    waitlistPosition: result.registration.waitlistPosition,
    passCode: result.registration.passCode,
    seatsRemaining: result.seatsRemaining,
    message:
      result.registration.status === 'CONFIRMED'
        ? 'You are registered. Your pass is ready to download.'
        : result.registration.status === 'WAITLISTED'
          ? `You are on the waitlist at position ${result.registration.waitlistPosition}.`
          : 'Registration received — awaiting payment confirmation.',
  };
}

/** Re-registers a student who previously cancelled. */
async function reRegister(
  event: {
    id: string;
    capacity: number;
    waitlistEnabled: boolean;
    registrationCount: number;
    collegeId: string;
    title: string;
  },
  student: { id: string; fullName: string; email: string },
  registrationId: string,
  input: RegisterInput,
  context: AuditContext,
): Promise<RegisterResult> {
  const result = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ capacity: number; waitlist_enabled: boolean }[]>`
      SELECT capacity, waitlist_enabled FROM events WHERE id = ${event.id} FOR UPDATE`;

    const confirmedCount = await tx.eventRegistration.count({
      where: { eventId: event.id, status: { in: ['CONFIRMED', 'ATTENDED'] } },
    });

    const hasSeats = !locked || locked.capacity === 0 || confirmedCount < locked.capacity;

    if (!hasSeats && !(locked?.waitlist_enabled ?? event.waitlistEnabled)) {
      throw new CapacityFullError('This event is full and has no waitlist');
    }
    if (!hasSeats && !input.acceptWaitlist) {
      throw new CapacityFullError('This event is full. Join the waitlist to be notified.');
    }

    const status: 'CONFIRMED' | 'WAITLISTED' = hasSeats ? 'CONFIRMED' : 'WAITLISTED';

    let waitlistPosition: number | null = null;
    if (status === 'WAITLISTED') {
      waitlistPosition =
        (await tx.eventRegistration.count({ where: { eventId: event.id, status: 'WAITLISTED' } })) + 1;
    }

    const updated = await tx.eventRegistration.update({
      where: { id: registrationId },
      // A new pass code is issued so a previously downloaded (cancelled) pass
      // cannot be reused to enter.
      data: {
        status,
        waitlistPosition,
        passCode: generatePassCode(),
        cancelledAt: null,
        cancelReason: null,
        registeredAt: new Date(),
        responses: (input.responses ?? undefined) as never,
      },
      select: { id: true, status: true, waitlistPosition: true, passCode: true },
    });

    await tx.event.update({
      where: { id: event.id },
      data: {
        registrationCount: { increment: status === 'CONFIRMED' ? 1 : 0 },
        waitlistCount: { increment: status === 'WAITLISTED' ? 1 : 0 },
      },
    });

    return updated;
  });

  auditAction(context, 'CREATE', 'EventRegistration', registrationId, {
    reRegistered: true,
    status: result.status,
  });

  return {
    registrationId: result.id,
    status: result.status,
    waitlistPosition: result.waitlistPosition,
    passCode: result.passCode,
    seatsRemaining: null,
    message:
      result.status === 'CONFIRMED'
        ? 'You are registered again. A new pass has been issued.'
        : `You are on the waitlist at position ${result.waitlistPosition}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Cancellation & waitlist promotion                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cancels a registration and, if the student held a confirmed seat, promotes the
 * next waitlisted student.
 */
export async function cancelRegistration(
  registrationId: string,
  actor: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
  options: { reason?: string; isOrganizerAction?: boolean },
  context: AuditContext,
): Promise<{ cancelled: boolean; promoted: { studentId: string; name: string } | null }> {
  const registration = assertFound(
    await prisma.eventRegistration.findFirst({
      where: { id: registrationId },
      select: {
        id: true,
        eventId: true,
        studentId: true,
        status: true,
        collegeId: true,
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            startAt: true,
            capacity: true,
            waitlistEnabled: true,
            organizerId: true,
            collegeId: true,
          },
        },
        student: { select: { id: true, fullName: true, email: true } },
      },
    }),
    'Registration',
  );

  const isOwner = registration.studentId === actor.id;
  const canManage = roleHasPermission(actor.role as never, 'event:manage_attendance');

  if (!isOwner && !canManage && !actor.isSuperAdmin) {
    throw new ForbiddenError('You can only cancel your own registration');
  }
  if (!isOwner && registration.event.collegeId !== actor.collegeId && !actor.isSuperAdmin) {
    throw new ForbiddenError('That registration belongs to another institution');
  }
  if (registration.status === 'CANCELLED') {
    throw new ConflictError('This registration is already cancelled');
  }
  if (registration.status === 'ATTENDED') {
    throw new ConflictError('Attendance has already been recorded for this registration');
  }

  const freedSeat = registration.status === 'CONFIRMED';
  const wasWaitlisted = registration.status === 'WAITLISTED';

  const promoted = await prisma.$transaction(async (tx) => {
    await tx.eventRegistration.update({
      where: { id: registrationId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: options.reason ?? (options.isOrganizerAction ? 'Cancelled by the organiser' : 'Cancelled by the student'),
        waitlistPosition: null,
      },
    });

    await tx.event.update({
      where: { id: registration.eventId },
      data: {
        registrationCount: { decrement: freedSeat ? 1 : 0 },
        waitlistCount: { decrement: wasWaitlisted ? 1 : 0 },
      },
    });

    // A confirmed seat freeing up promotes the next person in the queue.
    if (!freedSeat) return null;

    const next = await tx.eventRegistration.findFirst({
      where: { eventId: registration.eventId, status: 'WAITLISTED' },
      orderBy: { waitlistPosition: 'asc' },
      select: { id: true, studentId: true, student: { select: { fullName: true } } },
    });

    if (!next) return null;

    await tx.eventRegistration.update({
      where: { id: next.id },
      data: {
        status: 'CONFIRMED',
        waitlistPosition: null,
        promotedAt: new Date(),
      },
    });

    // Resequence the remaining queue so positions stay contiguous.
    const remaining = await tx.eventRegistration.findMany({
      where: { eventId: registration.eventId, status: 'WAITLISTED' },
      orderBy: { waitlistPosition: 'asc' },
      select: { id: true },
    });

    for (const [index, row] of remaining.entries()) {
      await tx.eventRegistration.update({
        where: { id: row.id },
        data: { waitlistPosition: index + 1 },
      });
    }

    await tx.event.update({
      where: { id: registration.eventId },
      data: { registrationCount: { increment: 1 } },
    });

    return { studentId: next.studentId, name: next.student.fullName, registrationId: next.id };
  });

  // Notify the promoted student outside the transaction.
  if (promoted) {
    await notify({
      userId: promoted.studentId,
      type: 'EVENT_REGISTRATION',
      title: `A seat opened up: ${registration.event.title}`,
      body: 'You have been moved off the waitlist and your registration is confirmed.',
      actionUrl: `/dashboard/events/pass/${promoted.registrationId}`,
      dedupeKey: `waitlist-promoted-${promoted.registrationId}`,
      email: () =>
        templates.waitlistPromotedEmail({
          studentName: promoted.name,
          eventTitle: registration.event.title,
          startAt: registration.event.startAt,
          passUrl: `${env.WEB_URL}/dashboard/events/pass/${promoted.registrationId}`,
        }),
    });
  }

  auditAction(
    context,
    'UPDATE',
    'EventRegistration',
    registrationId,
    {
      cancelled: true,
      previousStatus: registration.status,
      promotedStudentId: promoted?.studentId,
      isOrganizerAction: options.isOrganizerAction ?? false,
    },
  );

  return { cancelled: true, promoted };
}

async function waitlistPositionOf(registrationId: string): Promise<number> {
  const row = await prisma.eventRegistration.findUnique({
    where: { id: registrationId },
    select: { waitlistPosition: true },
  });
  return row?.waitlistPosition ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** The student's own registrations, for the dashboard and history timeline. */
export async function listMyRegistrations(
  studentId: string,
  filters: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    status?: string[];
    upcomingOnly?: boolean;
  },
) {
  const pagination = normalisePagination(filters);

  const where = {
    studentId,
    ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status as never } } : {}),
    ...(filters.upcomingOnly ? { event: { startAt: { gte: new Date() } } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.eventRegistration.findMany({
      where,
      orderBy: buildOrderBy(
        filters.sortBy,
        filters.sortOrder,
        ['registeredAt'] as const,
        'registeredAt',
        'desc',
      ),
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        status: true,
        passCode: true,
        waitlistPosition: true,
        registeredAt: true,
        cancelledAt: true,
        attendance: {
          select: { id: true, method: true, markedAt: true, revokedAt: true },
        },
        certificate: {
          select: { id: true, certificateId: true, title: true, status: true, issuedAt: true, pdfUrl: true },
        },
        event: {
          select: {
            id: true,
            slug: true,
            title: true,
            category: true,
            mode: true,
            status: true,
            bannerUrl: true,
            venue: true,
            startAt: true,
            endAt: true,
            capacity: true,
            fee: true,
            certificateEnabled: true,
            club: { select: { id: true, name: true, logoUrl: true } },
          },
        },
      },
    }),
    prisma.eventRegistration.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/** Roster for the organiser, with attendance state per student. */
export async function listEventRegistrations(
  eventId: string,
  filters: { page?: number; pageSize?: number; status?: string[]; search?: string },
) {
  const pagination = normalisePagination(filters);

  const where = {
    eventId,
    ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status as never } } : {}),
    ...(filters.search
      ? {
          OR: [
            { student: { fullName: { contains: filters.search, mode: 'insensitive' as const } } },
            { student: { email: { contains: filters.search, mode: 'insensitive' as const } } },
            { passCode: { contains: filters.search.toUpperCase() } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.eventRegistration.findMany({
      where,
      orderBy: [{ status: 'asc' }, { registeredAt: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        status: true,
        passCode: true,
        waitlistPosition: true,
        registeredAt: true,
        responses: true,
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            username: true,
            phone: true,
            department: { select: { name: true, code: true } },
            studentProfile: { select: { rollNumber: true, graduationYear: true } },
          },
        },
        attendance: { select: { id: true, method: true, markedAt: true, revokedAt: true } },
        certificate: { select: { id: true, certificateId: true, status: true } },
      },
    }),
    prisma.eventRegistration.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/* -------------------------------------------------------------------------- */
/* Digital pass                                                               */
/* -------------------------------------------------------------------------- */

export type EventPass = {
  registrationId: string;
  passCode: string;
  token: string;
  qrDataUrl: string;
  qrContent: string;
  event: {
    id: string;
    slug: string;
    title: string;
    category: string;
    mode: string;
    startAt: Date;
    endAt: Date;
    venue: string | null;
    meetingUrl: string | null;
    bannerUrl: string | null;
    clubName: string | null;
  };
  student: { id: string; fullName: string; username: string | null; avatarUrl: string | null; rollNumber: string | null };
  college: { name: string; logoUrl: string | null };
  status: string;
  /** True when the pass is valid at a scanner — false for cancelled/waitlisted. */
  scannable: boolean;
};

/**
 * Builds the downloadable digital pass.
 *
 * The QR encodes a signed token (see `utils/qr.ts`) rather than the registration
 * id, so the pass cannot be forged or reused at a different event. The same
 * payload is what the scanner endpoint verifies.
 */
export async function getEventPass(
  registrationId: string,
  viewer: { id: string; role: string; collegeId: string | null; isSuperAdmin: boolean },
): Promise<EventPass> {
  const registration = assertFound(
    await prisma.eventRegistration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        status: true,
        passCode: true,
        collegeId: true,
        student: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatarUrl: true,
            studentProfile: { select: { rollNumber: true } },
          },
        },
        event: {
          select: {
            id: true,
            slug: true,
            title: true,
            category: true,
            mode: true,
            status: true,
            startAt: true,
            endAt: true,
            venue: true,
            meetingUrl: true,
            bannerUrl: true,
            organizerId: true,
            club: { select: { name: true } },
            college: { select: { name: true, logoUrl: true } },
          },
        },
      },
    }),
    'Registration',
  );

  const isOwner = registration.student.id === viewer.id;
  const canManage = roleHasPermission(viewer.role as never, 'event:manage_attendance');

  if (!isOwner && !canManage && !viewer.isSuperAdmin) {
    throw new ForbiddenError('You can only view your own event pass');
  }

  const scannable =
    registration.status === 'CONFIRMED' &&
    ['PUBLISHED', 'ONGOING'].includes(registration.event.status);

  // The token is signed even for a non-scannable pass so the UI can render
  // something coherent; the scanner rejects it on status, not on signature.
  const token = signPassToken({
    registrationId: registration.id,
    eventId: registration.event.id,
    eventEndsAt: registration.event.endAt,
  });

  const qrContent = buildPassQrContent(token, registration.passCode);
  const qrDataUrl = await generateQrDataUrl(qrContent, { width: 512 });

  return {
    registrationId: registration.id,
    passCode: registration.passCode,
    token,
    qrDataUrl,
    qrContent,
    event: {
      id: registration.event.id,
      slug: registration.event.slug,
      title: registration.event.title,
      category: registration.event.category,
      mode: registration.event.mode,
      startAt: registration.event.startAt,
      endAt: registration.event.endAt,
      venue: registration.event.venue,
      meetingUrl: registration.event.meetingUrl,
      bannerUrl: registration.event.bannerUrl,
      clubName: registration.event.club?.name ?? null,
    },
    student: {
      id: registration.student.id,
      fullName: registration.student.fullName,
      username: registration.student.username,
      avatarUrl: registration.student.avatarUrl,
      rollNumber: registration.student.studentProfile?.rollNumber ?? null,
    },
    college: registration.event.college,
    status: registration.status,
    scannable,
  };
}

/* -------------------------------------------------------------------------- */
/* Organiser: manual add & bulk actions                                       */
/* -------------------------------------------------------------------------- */

/**
 * Adds a student to an event directly, bypassing capacity checks at the
 * organiser's discretion. Used for VIP guests, volunteers and walk-ins.
 */
export async function addStudentManually(
  eventId: string,
  studentId: string,
  actor: { id: string; collegeId: string | null; role: string },
  context: AuditContext,
): Promise<{ registrationId: string; passCode: string }> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { id: true, collegeId: true, title: true },
    }),
    'Event',
  );

  if (event.collegeId !== actor.collegeId) {
    throw new ForbiddenError('That event belongs to another institution');
  }

  const student = assertFound(
    await prisma.user.findFirst({
      where: { id: studentId, collegeId: event.collegeId, deletedAt: null },
      select: { id: true },
    }),
    'Student',
  );

  const existing = await prisma.eventRegistration.findUnique({
    where: { eventId_studentId: { eventId, studentId: student.id } },
    select: { id: true, status: true },
  });

  if (existing && existing.status !== 'CANCELLED') {
    throw new AlreadyRegisteredError('That student already has a registration for this event');
  }

  const passCode = generatePassCode();

  const registration = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.eventRegistration.update({
          where: { id: existing.id },
          data: {
            status: 'CONFIRMED',
            passCode,
            cancelledAt: null,
            cancelReason: null,
            waitlistPosition: null,
            registeredAt: new Date(),
          },
          select: { id: true, passCode: true },
        })
      : await tx.eventRegistration.create({
          data: {
            eventId,
            studentId: student.id,
            collegeId: event.collegeId,
            status: 'CONFIRMED',
            passCode,
          },
          select: { id: true, passCode: true },
        });

    await tx.event.update({
      where: { id: eventId },
      data: { registrationCount: { increment: 1 } },
    });

    return row;
  });

  auditAction(context, 'CREATE', 'EventRegistration', registration.id, {
    manual: true,
    studentId: student.id,
    byUserId: actor.id,
  });

  return { registrationId: registration.id, passCode: registration.passCode };
}
