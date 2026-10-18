import type { EventCategory, EventMode, EventStatus, Prisma } from '@prisma/client';
import { roleHasPermission } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  CapacityFullError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertFound,
  assertSameCollege,
} from '../../utils/errors.js';
import {
  buildDateRangeFilter,
  buildOrderBy,
  normalisePagination,
  paginated,
} from '../../utils/pagination.js';
import { sanitizeMultilineText, sanitizeText } from '../../utils/sanitize.js';
import { generatePassCode, uniqueSlug } from '../../utils/ids.js';
import { auditAction, auditBulk, auditCreate, auditUpdate, type AuditContext } from '../../utils/audit.js';
import { notify, notifyMany } from '../../services/notifications/notification.service.js';
import * as templates from '../../services/mailer/templates.js';
import { env } from '../../config/env.js';

/**
 * Event service.
 *
 * The largest Phase 1 module. Four areas live here:
 *
 *  1. **Lifecycle and approval.** A club lead creates a DRAFT, submits it, and it
 *     moves PENDING_FACULTY → PENDING_ADMIN → PUBLISHED. Every transition writes
 *     an `EventApproval` row, so the workflow is auditable rather than inferred
 *     from a single `approvedById` column.
 *
 *  2. **Discovery.** Filtered, paginated, tenant-scoped listing with a calendar
 *     projection.
 *
 *  3. **Registration.** Capacity, waitlisting, and promotion when a seat frees.
 *     This is the most concurrency-sensitive code in the module — see the note on
 *     `registerForEvent`.
 *
 *  4. **Counters.** `registrationCount`, `attendanceCount` etc. are maintained
 *     transactionally so list pages never need a `COUNT(*)` per row.
 */

/* -------------------------------------------------------------------------- */
/* Select shapes                                                              */
/* -------------------------------------------------------------------------- */

const EVENT_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  category: true,
  mode: true,
  status: true,
  bannerUrl: true,
  venue: true,
  meetingUrl: true,
  startAt: true,
  endAt: true,
  registrationDeadline: true,
  capacity: true,
  fee: true,
  currency: true,
  eligibleYears: true,
  tags: true,
  registrationCount: true,
  waitlistCount: true,
  attendanceCount: true,
  certificateEnabled: true,
  averageRating: true,
  feedbackCount: true,
  publishedAt: true,
  club: { select: { id: true, name: true, slug: true, logoUrl: true } },
  department: { select: { id: true, name: true, code: true } },
  college: { select: { id: true, name: true, slug: true, logoUrl: true } },
  organizer: { select: { id: true, fullName: true, avatarUrl: true } },
} satisfies Prisma.EventSelect;

/** Adds the heavy fields only fetched on the detail page. */
const EVENT_DETAIL_SELECT = {
  ...EVENT_CARD_SELECT,
  description: true,
  contactEmail: true,
  contactPhone: true,
  waitlistEnabled: true,
  certificateTemplateId: true,
  organizerId: true,
  createdAt: true,
  updatedAt: true,
  approvals: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      stage: true,
      decision: true,
      note: true,
      resultingStatus: true,
      createdAt: true,
      actor: { select: { id: true, fullName: true, role: true } },
    },
  },
} satisfies Prisma.EventSelect;

/* -------------------------------------------------------------------------- */
/* Discovery                                                                  */
/* -------------------------------------------------------------------------- */

export type EventListFilters = {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  category?: EventCategory[];
  mode?: EventMode[];
  status?: EventStatus[];
  clubId?: string;
  collegeId?: string;
  departmentId?: string;
  organizerId?: string;
  free?: boolean;
  from?: Date;
  to?: Date;
  registered?: boolean;
  available?: boolean;
  upcomingOnly?: boolean;
};

/**
 * Lists events for discovery.
 *
 * Visibility rule: an unauthenticated or student caller only ever sees PUBLISHED,
 * ONGOING and COMPLETED events. DRAFT, PENDING_* and REJECTED are visible only to
 * the organiser and to reviewers — otherwise an unapproved event would be
 * discoverable.
 */
export async function list(
  filters: EventListFilters,
  caller: {
    id?: string;
    collegeId: string | null;
    role?: string;
    isSuperAdmin?: boolean;
    canReview?: boolean;
  },
) {
  const pagination = normalisePagination(filters);

  const privileged = Boolean(caller.canReview || caller.isSuperAdmin);

  /**
   * Non-privileged callers are restricted to publicly visible statuses, with one
   * exception: their own draft events, so an organiser can see what they are
   * working on.
   */
  const statusFilter: Prisma.EventWhereInput = privileged
    ? filters.status
      ? { status: { in: filters.status } }
      : {}
    : filters.status
      ? { status: { in: filters.status.filter((s) => PUBLIC_STATUSES.includes(s)) } }
      : {
          OR: [
            { status: { in: PUBLIC_STATUSES } },
            ...(caller.id ? [{ organizerId: caller.id, status: 'DRAFT' as const }] : []),
            ...(caller.id
              ? [{ organizerId: caller.id, status: { in: ['PENDING_FACULTY', 'PENDING_ADMIN', 'REJECTED'] as const } }]
              : []),
          ],
        };

  const now = new Date();

  const where: Prisma.EventWhereInput = {
    deletedAt: null,
    // Tenant scoping. `caller.collegeId` is null only for an anonymous visitor,
    // in which case the explicit `collegeId` filter must be supplied.
    ...(caller.isSuperAdmin
      ? filters.collegeId
        ? { collegeId: filters.collegeId }
        : {}
      : caller.collegeId
        ? { collegeId: caller.collegeId }
        : filters.collegeId
          ? { collegeId: filters.collegeId }
          : {}),

    ...statusFilter,

    ...(filters.upcomingOnly !== false && !filters.from && !filters.to
      ? { endAt: { gte: now } }
      : {}),

    ...(filters.category && filters.category.length > 0 ? { category: { in: filters.category } } : {}),
    ...(filters.mode && filters.mode.length > 0 ? { mode: { in: filters.mode } } : {}),
    ...(filters.clubId ? { clubId: filters.clubId } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.organizerId ? { organizerId: filters.organizerId } : {}),
    ...(filters.free !== undefined ? { fee: filters.free ? 0 : { gt: 0 } } : {}),
    ...buildDateRangeFilter('startAt', filters.from, filters.to),
    ...(filters.registered && caller.id
      ? { registrations: { some: { studentId: caller.id, status: { not: 'CANCELLED' } } } }
      : {}),
    ...(filters.available ? { capacity: 0 } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search, mode: 'insensitive' } },
            { summary: { contains: filters.search, mode: 'insensitive' } },
            { description: { contains: filters.search, mode: 'insensitive' } },
            { tags: { has: filters.search } },
          ],
        }
      : {}),
  };

  /**
   * `available=true` needs a computed comparison (registrations < capacity), which
   * Prisma cannot express in a `where`. It is currently applied after the page is
   * fetched, which can underfill results and leave pagination totals inaccurate.
   * TODO(Phase 1 carryover): filter and count available events before pagination
   * with `registration_count < capacity OR capacity = 0`.
   */
  const orderBy = buildOrderBy(
    filters.sortBy,
    filters.sortOrder,
    ['startAt', 'createdAt', 'registrationCount', 'title'] as const,
    'startAt',
    'asc',
  );

  const [rawItems, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy,
      skip: pagination.skip,
      take: pagination.take,
      select: EVENT_CARD_SELECT,
    }),
    prisma.event.count({ where }),
  ]);

  const items = filters.available
    ? rawItems.filter((event) => event.capacity === 0 || event.registrationCount < event.capacity)
    : rawItems;

  // Annotate with the caller's own registration so the card can render
  // "Registered" without a second request per event.
  const withRegistration = caller.id
    ? await attachViewerRegistration(items, caller.id)
    : items.map((event) => ({ ...event, viewerRegistration: null }));

  return paginated(withRegistration, total, pagination);
}

/** Statuses visible without review privileges. */
const PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'ONGOING', 'COMPLETED', 'CANCELLED'];

async function attachViewerRegistration<T extends { id: string }>(events: T[], viewerId: string) {
  if (events.length === 0) return events.map((event) => ({ ...event, viewerRegistration: null }));

  const registrations = await prisma.eventRegistration.findMany({
    where: { studentId: viewerId, eventId: { in: events.map((e) => e.id) } },
    select: { eventId: true, id: true, status: true, passCode: true, waitlistPosition: true },
  });

  const byEvent = new Map(registrations.map((r) => [r.eventId, r]));

  return events.map((event) => ({
    ...event,
    viewerRegistration: byEvent.get(event.id) ?? null,
  }));
}

/** Month projection for the calendar view. */
export async function calendar(
  params: { month: number; year: number; collegeId?: string; category?: EventCategory[]; clubId?: string },
  caller: { collegeId: string | null; isSuperAdmin?: boolean; canReview?: boolean },
) {
  // The month is computed in the platform's operating timezone rather than UTC,
  // so an event on the 1st at 09:00 IST does not land in the previous month.
  const start = new Date(Date.UTC(params.year, params.month - 1, 1, 0, 0, 0) - 5.5 * 3600 * 1000);
  const end = new Date(Date.UTC(params.year, params.month, 1, 0, 0, 0) - 5.5 * 3600 * 1000);

  const events = await prisma.event.findMany({
    where: {
      deletedAt: null,
      startAt: { gte: start, lt: end },
      ...(caller.isSuperAdmin
        ? params.collegeId
          ? { collegeId: params.collegeId }
          : {}
        : { collegeId: caller.collegeId }),
      ...(caller.canReview ? {} : { status: { in: PUBLIC_STATUSES } }),
      ...(params.category && params.category.length > 0 ? { category: { in: params.category } } : {}),
      ...(params.clubId ? { clubId: params.clubId } : {}),
    },
    orderBy: { startAt: 'asc' },
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
      bannerUrl: true,
      capacity: true,
      registrationCount: true,
      club: { select: { id: true, name: true } },
    },
    take: 500,
  });

  // Group by day-of-month so the client renders without re-bucketing.
  const byDay = new Map<number, typeof events>();
  for (const event of events) {
    const day = event.startAt.getUTCDate();
    const bucket = byDay.get(day) ?? [];
    bucket.push(event);
    byDay.set(day, bucket);
  }

  return {
    month: params.month,
    year: params.year,
    total: events.length,
    days: [...byDay.entries()]
      .map(([day, dayEvents]) => ({ day, events: dayEvents }))
      .sort((a, b) => a.day - b.day),
  };
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                     */
/* -------------------------------------------------------------------------- */

export async function getBySlugOrId(
  identifier: string,
  viewer: {
    id?: string;
    collegeId: string | null;
    role?: string;
    canReview?: boolean;
    isSuperAdmin?: boolean;
  },
) {
  // Accept either the slug (public URL) or the cuid (internal links).
  const isCuid = /^c[a-z0-9]{20,}$/.test(identifier);

  const event = await prisma.event.findFirst({
    where: isCuid ? { id: identifier, deletedAt: null } : { slug: identifier, deletedAt: null },
    select: EVENT_DETAIL_SELECT,
  });

  if (!event) throw new NotFoundError('Event');

  const privileged =
    viewer.isSuperAdmin ||
    viewer.canReview ||
    event.organizerId === viewer.id ||
    // A club president can see their club's drafts.
    (viewer.id ? await isClubPresidentOf(event.id, viewer.id) : false);

  if (!PUBLIC_STATUSES.includes(event.status) && !privileged) {
    // Deliberately a 404 rather than a 403: telling a stranger that an unapproved
    // event exists leaks that it is coming.
    throw new NotFoundError('Event');
  }

  assertSameCollege(event.college.id, viewer.collegeId);

  const [viewerRegistration, attendanceStats] = await Promise.all([
    viewer.id
      ? prisma.eventRegistration.findUnique({
          where: { eventId_studentId: { eventId: event.id, studentId: viewer.id } },
          select: {
            id: true,
            status: true,
            passCode: true,
            waitlistPosition: true,
            registeredAt: true,
            cancelledAt: true,
          },
        })
      : null,
    prisma.attendance.count({ where: { eventId: event.id, revokedAt: null } }),
  ]);

  const seatsRemaining =
    event.capacity === 0 ? null : Math.max(0, event.capacity - event.registrationCount);

  return {
    ...event,
    viewerRegistration,
    stats: {
      seatsRemaining,
      /** Two hours before start, registration is closed even if the deadline is later. */
      registrationOpen: isRegistrationOpen(event),
      attendanceCount: attendanceStats,
      waitlistCount: event.waitlistCount,
    },
  };
}

async function isClubPresidentOf(eventId: string, userId: string): Promise<boolean> {
  const count = await prisma.event.count({
    where: { id: eventId, club: { presidentId: userId } },
  });
  return count > 0;
}

/** Registration is open until the deadline, and always before the event starts. */
export function isRegistrationOpen(event: {
  status: EventStatus;
  startAt: Date;
  registrationDeadline: Date | null;
  capacity: number;
  registrationCount: number;
}): boolean {
  if (event.status !== 'PUBLISHED') return false;
  if (event.startAt <= new Date()) return false;
  if (event.registrationDeadline && event.registrationDeadline < new Date()) return false;
  // Full events stay "open" when a waitlist exists, because registering still
  // works — it just joins the queue.
  return true;
}

/* -------------------------------------------------------------------------- */
/* Create / update                                                            */
/* -------------------------------------------------------------------------- */

export type CreateEventInput = {
  title: string;
  description: string;
  summary?: string;
  category: EventCategory;
  mode: EventMode;
  venue?: string;
  meetingUrl?: string;
  bannerUrl?: string | null;
  startAt: Date;
  endAt: Date;
  registrationDeadline?: Date;
  capacity: number;
  waitlistEnabled: boolean;
  fee: number;
  currency: string;
  certificateEnabled: boolean;
  certificateTemplateId?: string | null;
  clubId?: string | null;
  departmentId?: string | null;
  eligibleYears: number[];
  tags: string[];
  contactEmail?: string;
  contactPhone?: string;
};

export async function create(
  input: CreateEventInput,
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  context: AuditContext,
) {
  if (!caller.collegeId) {
    throw new ForbiddenError('Only college members can create events');
  }

  // A club-scoped event requires the caller to be that club's president or a
  // coordinator — otherwise anyone could publish under a club's name.
  if (input.clubId) {
    const club = await prisma.club.findFirst({
      where: { id: input.clubId, collegeId: caller.collegeId, deletedAt: null },
      select: { id: true, presidentId: true, name: true },
    });

    if (!club) throw new ValidationError('That club does not belong to your college');

    const canManageAny = roleHasPermission(caller.role as never, 'event:approve_faculty');
    if (club.presidentId !== caller.id && !canManageAny) {
      throw new ForbiddenError(`You are not a lead of ${club.name}`);
    }
  }

  if (input.departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: input.departmentId, collegeId: caller.collegeId, deletedAt: null },
      select: { id: true },
    });
    if (!department) throw new ValidationError('That department does not belong to your college');
  }

  if (input.certificateTemplateId) {
    const template = await prisma.certificateTemplate.findFirst({
      where: { id: input.certificateTemplateId, collegeId: caller.collegeId, deletedAt: null },
      select: { id: true },
    });
    if (!template) throw new ValidationError('That certificate template does not belong to your college');
  }

  const slug = await uniqueSlug(input.title, async (candidate) => {
    const count = await prisma.event.count({ where: { collegeId: caller.collegeId!, slug: candidate } });
    return count > 0;
  });

  const event = await prisma.event.create({
    data: {
      collegeId: caller.collegeId,
      slug,
      title: sanitizeText(input.title, 160),
      summary: input.summary ? sanitizeText(input.summary, 280) : null,
      description: sanitizeMultilineText(input.description, 8000),
      category: input.category,
      mode: input.mode,
      status: 'DRAFT',
      venue: input.venue ? sanitizeText(input.venue, 200) : null,
      meetingUrl: input.meetingUrl ?? null,
      bannerUrl: input.bannerUrl ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      registrationDeadline: input.registrationDeadline ?? null,
      capacity: input.capacity,
      waitlistEnabled: input.waitlistEnabled,
      fee: input.fee,
      currency: input.currency,
      certificateEnabled: input.certificateEnabled,
      certificateTemplateId: input.certificateTemplateId ?? null,
      clubId: input.clubId ?? null,
      departmentId: input.departmentId ?? null,
      eligibleYears: input.eligibleYears,
      tags: input.tags.map((tag) => sanitizeText(tag, 30)),
      organizerId: caller.id,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
    },
    select: EVENT_DETAIL_SELECT,
  });

  auditCreate(context, 'Event', event.id, {
    title: event.title,
    category: event.category,
    startAt: event.startAt,
  });

  return event;
}

export type UpdateEventInput = Partial<Omit<CreateEventInput, 'startAt' | 'endAt'>> & {
  startAt?: Date;
  endAt?: Date;
  registrationDeadline?: Date | null;
};

/**
 * Updates an event.
 *
 * Timing is re-validated against the *merged* record, because a partial patch
 * cannot be checked in isolation: moving `startAt` later without touching `endAt`
 * can invert the window, and moving the event past its registration deadline makes
 * the deadline meaningless.
 *
 * A PUBLISHED event cannot have its start time moved without re-approval — that is
 * the classic way to slip a materially different event past reviewers.
 */
export async function update(
  eventId: string,
  input: UpdateEventInput,
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  context: AuditContext,
) {
  const before = assertFound(
    await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        collegeId: true,
        organizerId: true,
        status: true,
        startAt: true,
        endAt: true,
        registrationDeadline: true,
        capacity: true,
        registrationCount: true,
        title: true,
        slug: true,
        clubId: true,
        mode: true,
        venue: true,
        meetingUrl: true,
        publishedAt: true,
      },
    }),
    'Event',
  );

  assertSameCollege(before.collegeId, caller.collegeId);
  await assertCanManage(before, caller);

  // --- Merge and re-validate timing ----------------------------------------
  const nextStart = input.startAt ?? before.startAt;
  const nextEnd = input.endAt ?? before.endAt;
  const nextDeadline =
    input.registrationDeadline === undefined ? before.registrationDeadline : input.registrationDeadline;

  if (nextEnd <= nextStart) {
    throw new ValidationError('End time must be after the start time', [
      { path: 'endAt', message: 'End time must be after the start time' },
    ]);
  }
  if (nextDeadline && nextDeadline > nextStart) {
    throw new ValidationError('Registration must close on or before the start time', [
      { path: 'registrationDeadline', message: 'Must be on or before the start time' },
    ]);
  }

  const timingChanged = nextStart.getTime() !== before.startAt.getTime();

  /**
   * A published event whose time moves is pulled back into review. The scheduler
   * may reject this for genuine corrections; the escape hatch is that a coordinator
   * or admin can publish directly, which the approval step below permits.
   */
  const requiresReapproval =
    timingChanged &&
    (before.status === 'PUBLISHED' || before.status === 'ONGOING') &&
    before.registrationCount > 0;

  if (requiresReapproval && !roleHasPermission(caller.role as never, 'event:approve_admin')) {
    throw new ConflictError(
      'This event already has registrations. Ask a faculty coordinator to change the schedule so students can be notified.',
    );
  }

  // --- Mode consistency -----------------------------------------------------
  const nextMode = input.mode ?? before.mode;
  const nextVenue = input.venue !== undefined ? input.venue : before.venue;
  const nextMeetingUrl = input.meetingUrl !== undefined ? input.meetingUrl : before.meetingUrl;

  if ((nextMode === 'OFFLINE' || nextMode === 'HYBRID') && !nextVenue) {
    throw new ValidationError('A venue is required for offline and hybrid events', [
      { path: 'venue', message: 'Required for offline events' },
    ]);
  }
  if ((nextMode === 'ONLINE' || nextMode === 'HYBRID') && !nextMeetingUrl) {
    throw new ValidationError('A meeting link is required for online and hybrid events', [
      { path: 'meetingUrl', message: 'Required for online events' },
    ]);
  }

  // --- Capacity -------------------------------------------------------------
  if (input.capacity !== undefined && input.capacity > 0 && input.capacity < before.registrationCount) {
    throw new ConflictError(
      `Capacity cannot be below the ${before.registrationCount} students already registered. Cancel registrations first.`,
    );
  }

  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({
      where: { id: eventId },
      data: {
        ...(input.title !== undefined ? { title: sanitizeText(input.title, 160) } : {}),
        ...(input.summary !== undefined
          ? { summary: input.summary ? sanitizeText(input.summary, 280) : null }
          : {}),
        ...(input.description !== undefined
          ? { description: sanitizeMultilineText(input.description, 8000) }
          : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.venue !== undefined ? { venue: input.venue } : {}),
        ...(input.meetingUrl !== undefined ? { meetingUrl: input.meetingUrl } : {}),
        ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
        ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
        ...(input.registrationDeadline !== undefined
          ? { registrationDeadline: input.registrationDeadline }
          : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.waitlistEnabled !== undefined ? { waitlistEnabled: input.waitlistEnabled } : {}),
        ...(input.fee !== undefined ? { fee: input.fee } : {}),
        ...(input.certificateEnabled !== undefined
          ? { certificateEnabled: input.certificateEnabled }
          : {}),
        ...(input.certificateTemplateId !== undefined
          ? { certificateTemplateId: input.certificateTemplateId }
          : {}),
        ...(input.clubId !== undefined ? { clubId: input.clubId } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.eligibleYears !== undefined ? { eligibleYears: input.eligibleYears } : {}),
        ...(input.tags !== undefined ? { tags: input.tags.map((t) => sanitizeText(t, 30)) } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        // Re-approval: back to the first review stage.
        ...(requiresReapproval && before.status === 'PUBLISHED'
          ? { status: 'PENDING_FACULTY' as const, publishedAt: null }
          : {}),
      },
      select: EVENT_DETAIL_SELECT,
    });

    // Write a synthetic approval row recording the schedule change, so the history
    // explains why the event left PUBLISHED.
    if (requiresReapproval) {
      await tx.eventApproval.create({
        data: {
          eventId,
          stage: 'ADMIN',
          decision: 'REQUEST_CHANGES',
          note: 'Schedule changed after students had registered — returned to review.',
          actorId: caller.id,
          resultingStatus: 'PENDING_FACULTY',
        },
      });
    }

    return updated;
  });

  auditUpdate(context, 'Event', eventId, before, after, {
    timingChanged,
    requiresReapproval,
  });

  /*
   * Notify registrants when the schedule of a published event moves. This is the
   * reason re-approval exists: a student who registered for a Tuesday workshop
   * needs to know it is now Thursday.
   */
  if (timingChanged && before.registrationCount > 0) {
    void notifyRegistrantsOfChange(eventId, {
      title: before.title,
      startAt: nextStart,
      venue: nextVenue ?? null,
      meetingUrl: nextMeetingUrl ?? null,
    }).catch((error: unknown) => {
      logger.warn('Failed to notify registrants of an event change', { eventId, error: String(error) });
    });
  }

  return after;
}

/** Shared authorisation check for event mutations. */
async function assertCanManage(
  event: { organizerId: string; clubId: string | null; collegeId: string },
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
): Promise<void> {
  assertSameCollege(event.collegeId, caller.collegeId);

  if (caller.isSuperAdmin) return;
  if (event.organizerId === caller.id) return;

  const canManageAny = roleHasPermission(caller.role as never, 'event:approve_faculty');
  if (canManageAny) return;

  // A club president may edit their club's events.
  if (event.clubId) {
    const count = await prisma.club.count({
      where: { id: event.clubId, presidentId: caller.id },
    });
    if (count > 0) return;
  }

  throw new ForbiddenError('Only the organiser or a coordinator can manage this event');
}

async function notifyRegistrantsOfChange(
  eventId: string,
  details: { title: string; startAt: Date; venue: string | null; meetingUrl: string | null },
): Promise<void> {
  const registrations = await prisma.eventRegistration.findMany({
    where: { eventId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
    select: { studentId: true, passCode: true },
  });

  if (registrations.length === 0) return;

  await notifyMany(
    registrations.map((r) => r.studentId),
    (studentId) => ({
      userId: studentId,
      type: 'EVENT_UPDATED' as const,
      title: `${details.title} has been rescheduled`,
      body: `${details.title} now starts at ${details.startAt.toLocaleString('en-IN')}. Check the event page for the updated details.`,
      actionUrl: `/events/${eventId}`,
      groupKey: `event-change-${eventId}`,
      forceChannels: ['IN_APP', 'EMAIL'],
    }),
    { concurrency: 8 },
  );
}

/* -------------------------------------------------------------------------- */
/* Approval workflow                                                          */
/* -------------------------------------------------------------------------- */

/** Submits a draft for review. */
export async function submitForApproval(
  eventId: string,
  note: string | undefined,
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<{ status: EventStatus }> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        collegeId: true,
        organizerId: true,
        clubId: true,
        status: true,
        title: true,
        startAt: true,
        endAt: true,
        venue: true,
        mode: true,
        meetingUrl: true,
        capacity: true,
        description: true,
      },
    }),
    'Event',
  );

  await assertCanManage(event, caller);

  if (!['DRAFT', 'REJECTED'].includes(event.status)) {
    throw new ConflictError(`An event with status ${event.status} cannot be submitted for review`);
  }

  // Completeness check before it leaves the organiser's hands — a reviewer should
  // never be asked to approve an event missing a venue or a description.
  const problems: string[] = [];
  if (event.description.trim().length < 30) problems.push('the description is too short');
  if (event.startAt <= new Date()) problems.push('the start time is in the past');
  if ((event.mode === 'OFFLINE' || event.mode === 'HYBRID') && !event.venue) {
    problems.push('an offline event needs a venue');
  }
  if ((event.mode === 'ONLINE' || event.mode === 'HYBRID') && !event.meetingUrl) {
    problems.push('an online event needs a meeting link');
  }

  if (problems.length > 0) {
    throw new ValidationError(`Complete the event before submitting: ${problems.join(', ')}.`);
  }

  const status: EventStatus = 'PENDING_FACULTY';

  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { status } }),
    prisma.eventApproval.create({
      data: {
        eventId,
        stage: 'FACULTY',
        decision: 'APPROVE',
        note: note ? sanitizeText(note, 500) : null,
        actorId: caller.id,
        resultingStatus: status,
      },
    }),
  ]);

  // A club lead's event always starts at faculty review; a faculty member's own
  // event starts at admin review, since they are the first stage themselves.
  if (event.clubId) {
    await notifyClubFaculty(event.clubId, event);
  }

  auditAction(context, 'APPROVE', 'Event', eventId, { transition: `${event.status} → ${status}` });

  return { status };
}

async function notifyClubFaculty(
  clubId: string,
  event: { id: string; title: string; collegeId: string },
): Promise<void> {
  const coordinators = await prisma.user.findMany({
    where: {
      collegeId: event.collegeId,
      role: { in: ['FACULTY_COORDINATOR', 'COLLEGE_ADMIN'] },
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: { id: true },
  });

  await notifyMany(
    coordinators.map((c) => c.id),
    (userId) => ({
      userId,
      type: 'SYSTEM',
      title: 'Event awaiting your review',
      body: `"${event.title}" has been submitted and needs approval.`,
      actionUrl: `/dashboard/organizer/approvals`,
      groupKey: `event-approval-${event.id}`,
      dedupeKey: `event-approval-${event.id}-${userId}`,
    }),
    { concurrency: 8 },
  );
}

/**
 * Records an approval decision.
 *
 * The chain is FACULTY then ADMIN. Two deliberate affordances:
 *  - A COLLEGE_ADMIN may approve both stages in one call when the faculty stage is
 *    still pending, because a small college often has no separate coordinator.
 *  - REQUEST_CHANGES returns the event to DRAFT rather than REJECTED, so the
 *    organiser can edit and resubmit without losing the approval history.
 */
export async function decide(
  eventId: string,
  input: { decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'; note?: string },
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<{ status: EventStatus }> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        collegeId: true,
        organizerId: true,
        title: true,
        status: true,
        startAt: true,
      },
    }),
    'Event',
  );

  assertSameCollege(event.collegeId, caller.collegeId);

  const canApproveFaculty = roleHasPermission(caller.role as never, 'event:approve_faculty');
  const canApproveAdmin = roleHasPermission(caller.role as never, 'event:approve_admin');

  if (!canApproveFaculty && !canApproveAdmin) {
    throw new ForbiddenError('You do not have permission to review events');
  }

  // An organiser must not approve their own event — the whole point of the chain.
  if (event.organizerId === caller.id) {
    throw new ForbiddenError('You cannot review your own event');
  }

  let nextStatus: EventStatus;
  let stage: 'FACULTY' | 'ADMIN';

  if (event.status === 'PENDING_FACULTY') {
    if (!canApproveFaculty && !canApproveAdmin) {
      throw new ForbiddenError('Faculty approval is required first');
    }
    stage = 'FACULTY';

    if (input.decision === 'APPROVE') {
      // An admin approving at the faculty stage clears both in one action.
      if (canApproveAdmin && !canApproveFaculty) {
        nextStatus = 'PUBLISHED';
        stage = 'ADMIN';
      } else {
        nextStatus = 'PENDING_ADMIN';
      }
    } else if (input.decision === 'REJECT') {
      nextStatus = 'REJECTED';
    } else {
      nextStatus = 'DRAFT';
    }
  } else if (event.status === 'PENDING_ADMIN') {
    if (!canApproveAdmin) throw new ForbiddenError('Only a college administrator can publish an event');
    stage = 'ADMIN';

    if (input.decision === 'APPROVE') nextStatus = 'PUBLISHED';
    else if (input.decision === 'REJECT') nextStatus = 'REJECTED';
    else nextStatus = 'DRAFT';
  } else {
    throw new ConflictError(`An event with status ${event.status} is not awaiting review`);
  }

  const publishesNow = nextStatus === 'PUBLISHED';

  await prisma.$transaction([
    prisma.event.update({
      where: { id: eventId },
      data: {
        status: nextStatus,
        ...(publishesNow ? { publishedAt: new Date() } : {}),
      },
    }),
    prisma.eventApproval.create({
      data: {
        eventId,
        stage,
        decision: input.decision,
        note: input.note ? sanitizeText(input.note, 1000) : null,
        actorId: caller.id,
        resultingStatus: nextStatus,
      },
    }),
  ]);

  await notify({
    userId: event.organizerId,
    type: 'SYSTEM',
    title:
      nextStatus === 'PUBLISHED'
        ? `${event.title} is live`
        : nextStatus === 'DRAFT'
          ? `${event.title} needs changes`
          : nextStatus === 'REJECTED'
            ? `${event.title} was rejected`
            : `${event.title} passed faculty review`,
    body:
      nextStatus === 'PUBLISHED'
        ? 'Your event is published and students can register.'
        : nextStatus === 'DRAFT'
          ? `Changes requested: ${input.note ?? 'see the event page'}`
          : nextStatus === 'REJECTED'
            ? `Reason: ${input.note ?? 'not specified'}`
            : 'It now needs administrator approval before it goes live.',
    actionUrl: `/dashboard/organizer/events/${eventId}`,
    dedupeKey: `event-decision-${eventId}-${nextStatus}-${caller.id}`,
    email: () =>
      templates.eventApprovalEmail({
        organizerName: 'there',
        eventTitle: event.title,
        decision: input.decision,
        note: input.note ?? null,
        reviewerName: caller.role.replace(/_/g, ' ').toLowerCase(),
        eventUrl: `${env.WEB_URL}/dashboard/organizer/events/${eventId}`,
      }),
  });

  auditAction(context, input.decision === 'APPROVE' ? 'APPROVE' : 'REJECT', 'Event', eventId, {
    stage,
    from: event.status,
    to: nextStatus,
  });

  return { status: nextStatus };
}

/** Approvals awaiting the caller, for the organiser dashboard. */
export async function pendingApprovals(
  caller: { collegeId: string | null; role: string; isSuperAdmin: boolean },
  filters: { page?: number; pageSize?: number },
) {
  const pagination = normalisePagination(filters);

  const canApproveAdmin = roleHasPermission(caller.role as never, 'event:approve_admin');

  const where: Prisma.EventWhereInput = {
    deletedAt: null,
    ...(caller.isSuperAdmin ? {} : { collegeId: caller.collegeId }),
    // An admin sees both queues; a faculty coordinator sees only the first.
    status: canApproveAdmin ? { in: ['PENDING_FACULTY', 'PENDING_ADMIN'] } : 'PENDING_FACULTY',
  };

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { startAt: 'asc' },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        ...EVENT_CARD_SELECT,
        approvals: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            stage: true,
            decision: true,
            note: true,
            createdAt: true,
            actor: { select: { id: true, fullName: true, role: true } },
          },
        },
      },
    }),
    prisma.event.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/* -------------------------------------------------------------------------- */
/* Lifecycle transitions                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cancels an event and notifies every registrant.
 *
 * Cancellation is a soft state (CANCELLED) rather than a delete: certificates may
 * already exist, and students need to see why their event disappeared.
 */
export async function cancel(
  eventId: string,
  reason: string,
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<{ notified: number }> {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        collegeId: true,
        organizerId: true,
        clubId: true,
        status: true,
        title: true,
        registrationCount: true,
      },
    }),
    'Event',
  );

  await assertCanManage(event, caller);

  if (event.status === 'CANCELLED') throw new ConflictError('This event is already cancelled');
  if (event.status === 'COMPLETED') {
    throw new ConflictError('A completed event cannot be cancelled');
  }

  const registrations = await prisma.eventRegistration.findMany({
    where: { eventId, status: { in: ['CONFIRMED', 'WAITLISTED', 'PENDING'] } },
    select: { studentId: true },
  });

  await prisma.$transaction([
    prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: sanitizeText(reason, 500),
      },
    }),
    prisma.eventRegistration.updateMany({
      where: { eventId, status: { in: ['CONFIRMED', 'WAITLISTED', 'PENDING'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Event cancelled by the organiser' },
    }),
  ]);

  const { sent } = await notifyMany(
    registrations.map((r) => r.studentId),
    (userId) => ({
      userId,
      type: 'EVENT_UPDATED' as const,
      title: `${event.title} has been cancelled`,
      body: `This event has been cancelled. Reason: ${reason}`,
      actionUrl: `/events/${eventId}`,
      forceChannels: ['IN_APP', 'EMAIL'],
      groupKey: `event-cancelled-${eventId}`,
      dedupeKey: `event-cancelled-${eventId}-${userId}`,
    }),
    { concurrency: 8 },
  );

  auditAction(context, 'UPDATE', 'Event', eventId, { cancelled: true, reason, notified: sent });

  return { notified: sent };
}

/**
 * Marks finished events as COMPLETED and no-shows as NO_SHOW.
 *
 * Intended to run on a schedule (cron or a platform scheduler). Kept idempotent so
 * a double run is harmless.
 */
export async function runLifecycleSweep(): Promise<{
  started: number;
  completed: number;
  noShows: number;
}> {
  const now = new Date();

  // PUBLISHED events whose start time has arrived become ONGOING.
  const started = await prisma.event.updateMany({
    where: { status: 'PUBLISHED', startAt: { lte: now }, endAt: { gt: now }, deletedAt: null },
    data: { status: 'ONGOING' },
  });

  // Events whose end time has passed become COMPLETED, from either live state.
  const finishing = await prisma.event.findMany({
    where: { status: { in: ['PUBLISHED', 'ONGOING'] }, endAt: { lte: now }, deletedAt: null },
    select: { id: true },
  });

  const completed = finishing.length;

  for (const { id } of finishing) {
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now } });

      // Anyone confirmed but never scanned is a no-show. Waitlisted students are
      // left alone — they were never expected to attend.
      await tx.eventRegistration.updateMany({
        where: { eventId: id, status: 'CONFIRMED' },
        data: { status: 'NO_SHOW' },
      });

      await tx.eventRegistration.updateMany({
        where: { eventId: id, status: 'ATTENDED' },
        data: { status: 'ATTENDED' },
      });
    });
  }

  const noShows = await prisma.eventRegistration.count({
    where: { status: 'NO_SHOW', event: { endAt: { lte: now } } },
  });

  logger.info('Event lifecycle sweep complete', {
    started: started.count,
    completed,
    noShows,
  });

  return { started: started.count, completed, noShows };
}

export { EVENT_CARD_SELECT, EVENT_DETAIL_SELECT, PUBLIC_STATUSES, notifyRegistrantsOfChange };
