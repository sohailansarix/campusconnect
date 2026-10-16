import type { Prisma } from '@prisma/client';
import type { ClubCategory } from '@campusconnect/shared';
import { roleHasPermission } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  assertFound,
  assertSameCollege,
} from '../../utils/errors.js';
import { buildOrderBy, buildSearchFilter, normalisePagination, paginated } from '../../utils/pagination.js';
import { sanitizeMultilineText, sanitizeText } from '../../utils/sanitize.js';
import { uniqueSlug } from '../../utils/ids.js';
import { auditCreate, auditUpdate, type AuditContext } from '../../utils/audit.js';
import { notify } from '../notifications/notification.service.js';

/**
 * Club service.
 *
 * Covers club CRUD, membership requests and approvals.
 *
 * Two rules that shape the code:
 *
 *  * **A club belongs to exactly one college.** Members must belong to the same
 *    college as the club. Enforced on join and on approval, not just on display —
 *    otherwise a cross-college membership would leak a student into another
 *    college's activity analytics.
 *
 *  * **Membership is a request, not a join.** A student creates a PENDING row; a
 *    club lead or faculty coordinator approves it. Auto-join would let anyone
 *    inflate a club's member count and appear on its roster.
 */

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

const CLUB_SUMMARY_SELECT = {
  id: true,
  name: true,
  slug: true,
  category: true,
  description: true,
  logoUrl: true,
  bannerUrl: true,
  email: true,
  meetingSchedule: true,
  isRecruiting: true,
  isActive: true,
  memberCount: true,
  eventCount: true,
  createdAt: true,
  president: { select: { id: true, fullName: true, avatarUrl: true, username: true } },
  _count: { select: { memberships: true, events: true } },
} satisfies Prisma.ClubSelect;

export async function list(
  filters: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    search?: string;
    category?: ClubCategory;
    isRecruiting?: boolean;
    collegeId?: string;
    /** Restrict to clubs the caller belongs to. */
    mine?: boolean;
  },
  caller: { id: string; collegeId: string | null; isSuperAdmin: boolean },
) {
  const pagination = normalisePagination(filters);

  const where: Prisma.ClubWhereInput = {
    deletedAt: null,
    isActive: true,
    // Tenant scoping: a non-super-admin only ever sees their own college.
    ...(caller.isSuperAdmin
      ? filters.collegeId
        ? { collegeId: filters.collegeId }
        : {}
      : { collegeId: caller.collegeId }),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.isRecruiting !== undefined ? { isRecruiting: filters.isRecruiting } : {}),
    ...(filters.mine
      ? { memberships: { some: { userId: caller.id, status: 'ACTIVE', deletedAt: null } } }
      : {}),
    ...buildSearchFilter(filters.search, ['name', 'description'] as const),
  };

  const [items, total] = await Promise.all([
    prisma.club.findMany({
      where,
      orderBy: buildOrderBy(
        filters.sortBy,
        filters.sortOrder,
        ['name', 'memberCount', 'eventCount', 'createdAt'] as const,
        'memberCount',
      ),
      skip: pagination.skip,
      take: pagination.take,
      select: CLUB_SUMMARY_SELECT,
    }),
    prisma.club.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

export async function getById(
  clubId: string,
  options: { viewerId?: string } = {},
) {
  const club = await prisma.club.findFirst({
    where: { id: clubId, deletedAt: null },
    select: {
      ...CLUB_SUMMARY_SELECT,
      college: { select: { id: true, name: true, slug: true, logoUrl: true } },
      memberships: {
        where: { status: 'ACTIVE', deletedAt: null },
        orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
        take: 40,
        select: {
          id: true,
          role: true,
          joinedAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              username: true,
              department: { select: { code: true } },
            },
          },
        },
      },
      events: {
        where: { deletedAt: null, status: { in: ['PUBLISHED', 'ONGOING', 'COMPLETED'] } },
        orderBy: { startAt: 'desc' },
        take: 12,
        select: {
          id: true,
          slug: true,
          title: true,
          startAt: true,
          endAt: true,
          venue: true,
          mode: true,
          category: true,
          bannerUrl: true,
          registrationCount: true,
          capacity: true,
        },
      },
    },
  });

  if (!club) throw new NotFoundError('Club');

  // The viewer's own membership, so the UI can render "Join" vs "Pending" vs
  // "Member" without a second request.
  const viewerMembership = options.viewerId
    ? await prisma.clubMembership.findUnique({
        where: { clubId_userId: { clubId, userId: options.viewerId } },
        select: { id: true, status: true, role: true },
      })
    : null;

  return { ...club, viewerMembership };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export type CreateClubInput = {
  name: string;
  category: ClubCategory;
  description: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  email?: string;
  meetingSchedule?: string | null;
  presidentId?: string | null;
  isRecruiting?: boolean;
};

export async function create(
  input: CreateClubInput,
  caller: { id: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
) {
  if (!caller.collegeId && !caller.isSuperAdmin) {
    throw new ForbiddenError('Your account is not linked to a college');
  }

  const collegeId = caller.collegeId ?? (input as unknown as { collegeId: string }).collegeId;

  // The president must be a member of the same college. Without this check a
  // club could be parked under a different institution.
  if (input.presidentId) {
    const president = await prisma.user.findFirst({
      where: { id: input.presidentId, deletedAt: null, collegeId },
      select: { id: true },
    });
    if (!president) throw new ForbiddenError('That president does not belong to this college');
  }

  const slug = await uniqueSlug(input.name, async (candidate) => {
    const count = await prisma.club.count({ where: { collegeId, slug: candidate } });
    return count > 0;
  });

  const club = await prisma.$transaction(async (tx) => {
    const created = await tx.club.create({
      data: {
        collegeId,
        name: sanitizeText(input.name, 120),
        slug,
        category: input.category,
        description: sanitizeMultilineText(input.description, 2000),
        logoUrl: input.logoUrl ?? null,
        bannerUrl: input.bannerUrl ?? null,
        email: input.email ?? null,
        meetingSchedule: input.meetingSchedule ?? null,
        presidentId: input.presidentId ?? null,
        isRecruiting: input.isRecruiting ?? true,
      },
      select: { id: true, name: true, slug: true },
    });

    // The president is a member by virtue of the role — creating the membership
    // row here keeps the member count honest.
    if (input.presidentId) {
      await tx.clubMembership.create({
        data: {
          clubId: created.id,
          userId: input.presidentId,
          collegeId,
          role: 'PRESIDENT',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      await tx.club.update({
        where: { id: created.id },
        data: { memberCount: { increment: 1 } },
      });
    }

    return created;
  });

  auditCreate(context, 'Club', club.id, { name: club.name, category: input.category });

  return club;
}

export type UpdateClubInput = {
  name?: string;
  category?: ClubCategory;
  description?: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  email?: string | null;
  meetingSchedule?: string | null;
  isRecruiting?: boolean;
  isActive?: boolean;
};

export async function update(
  clubId: string,
  input: UpdateClubInput,
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  context: AuditContext,
) {
  const club = assertFound(
    await prisma.club.findFirst({
      where: { id: clubId, deletedAt: null },
      select: {
        id: true,
        collegeId: true,
        presidentId: true,
        name: true,
        category: true,
        description: true,
        logoUrl: true,
        bannerUrl: true,
        email: true,
        meetingSchedule: true,
        isRecruiting: true,
        isActive: true,
      },
    }),
    'Club',
  );

  // Tenant boundary first, then ownership.
  assertSameCollege(club.collegeId, caller.collegeId);

  const canManageAny = roleHasPermission(caller.role as never, 'club:manage_members');
  const isPresident = club.presidentId === caller.id;

  if (!isPresident && !canManageAny) {
    throw new ForbiddenError('Only the club president or a coordinator can edit this club');
  }

  const after = await prisma.club.update({
    where: { id: clubId },
    data: {
      ...(input.name !== undefined ? { name: sanitizeText(input.name, 120) } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.description !== undefined
        ? { description: sanitizeMultilineText(input.description, 2000) }
        : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.meetingSchedule !== undefined ? { meetingSchedule: input.meetingSchedule } : {}),
      ...(input.isRecruiting !== undefined ? { isRecruiting: input.isRecruiting } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: CLUB_SUMMARY_SELECT,
  });

  auditUpdate(context, 'Club', clubId, club, after);

  return after;
}

export async function softDelete(
  clubId: string,
  caller: { collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<void> {
  const club = assertFound(
    await prisma.club.findFirst({
      where: { id: clubId, deletedAt: null },
      select: { id: true, collegeId: true, name: true },
    }),
    'Club',
  );

  assertSameCollege(club.collegeId, caller.collegeId);

  // Refuse while events are still attached — deleting the club would orphan them
  // and break every event page that links back to it.
  const eventCount = await prisma.event.count({ where: { clubId, deletedAt: null } });
  if (eventCount > 0) {
    throw new ConflictError(
      `This club has ${eventCount} event${eventCount === 1 ? '' : 's'}. Move or delete them before removing the club.`,
    );
  }

  await prisma.$transaction([
    prisma.club.update({ where: { id: clubId }, data: { deletedAt: new Date(), isActive: false } }),
    prisma.clubMembership.updateMany({
      where: { clubId, status: 'ACTIVE' },
      data: { status: 'LEFT', deletedAt: new Date() },
    }),
  ]);

  auditUpdate(context, 'Club', clubId, { isActive: true }, { isActive: false }, { deleted: true });
}

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

export type JoinInput = { message?: string; requestedRole?: string };

/**
 * Creates a membership request.
 *
 * `requestedRole` above MEMBER is recorded but not granted — the lead assigns the
 * actual role on approval. Letting a student request PRESIDENT and having it
 * auto-apply would be an obvious escalation.
 */
export async function requestMembership(
  clubId: string,
  userId: string,
  input: JoinInput,
  context: AuditContext,
): Promise<{ id: string; status: string }> {
  const club = assertFound(
    await prisma.club.findFirst({
      where: { id: clubId, deletedAt: null, isActive: true },
      select: { id: true, collegeId: true, name: true, isRecruiting: true, presidentId: true },
    }),
    'Club',
  );

  if (!club.isRecruiting) throw new ConflictError('This club is not accepting new members right now');

  const user = assertFound(
    await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, collegeId: true, departmentId: true, fullName: true },
    }),
    'User',
  );

  // Same-college rule — see the file header.
  if (user.collegeId !== club.collegeId) {
    throw new ForbiddenError('You can only join clubs at your own college');
  }

  const existing = await prisma.clubMembership.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === 'PENDING') throw new ConflictError('Your request is already awaiting review');
    if (existing.status === 'ACTIVE') throw new ConflictError('You are already a member of this club');

    // A previously rejected or left membership can be re-requested; reuse the row
    // so the unique constraint stays satisfied.
    const updated = await prisma.clubMembership.update({
      where: { id: existing.id },
      data: {
        status: 'PENDING',
        role: 'MEMBER',
        message: input.message ? sanitizeText(input.message, 500) : null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
        deletedAt: null,
      },
      select: { id: true, status: true },
    });

    if (club.presidentId) {
      await notify({
        userId: club.presidentId,
        type: 'CLUB_MEMBERSHIP',
        title: 'New membership request',
        body: `${user.fullName} has requested to join ${club.name}.`,
        actionUrl: `/dashboard/organizer/clubs/${club.id}/requests`,
        groupKey: `club-${club.id}-requests`,
      });
    }

    auditCreate(context, 'ClubMembership', updated.id, { clubId, requestedRole: input.requestedRole });
    return updated;
  }

  const membership = await prisma.clubMembership.create({
    data: {
      clubId,
      userId,
      collegeId: club.collegeId,
      departmentId: user.departmentId,
      role: 'MEMBER',
      status: 'PENDING',
      message: input.message ? sanitizeText(input.message, 500) : null,
    },
    select: { id: true, status: true },
  });

  if (club.presidentId) {
    await notify({
      userId: club.presidentId,
      type: 'CLUB_MEMBERSHIP',
      title: 'New membership request',
      body: `${user.fullName} has requested to join ${club.name}.`,
      actionUrl: `/dashboard/organizer/clubs/${club.id}/requests`,
      groupKey: `club-${club.id}-requests`,
      dedupeKey: `club-request-${membership.id}`,
    });
  }

  auditCreate(context, 'ClubMembership', membership.id, { clubId, requestedRole: input.requestedRole });

  return membership;
}

/**
 * Approves or rejects a membership request.
 *
 * Approval increments the denormalised `memberCount` in the same transaction as
 * the status change, so the count can never drift from the roster.
 */
export async function reviewMembership(
  membershipId: string,
  decision: { status: 'ACTIVE' | 'REJECTED'; role?: string; reviewNote?: string },
  reviewer: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<void> {
  const membership = assertFound(
    await prisma.clubMembership.findFirst({
      where: { id: membershipId, deletedAt: null },
      select: {
        id: true,
        clubId: true,
        userId: true,
        status: true,
        role: true,
        collegeId: true,
        club: { select: { name: true, presidentId: true, id: true } },
        user: { select: { fullName: true } },
      },
    }),
    'Membership request',
  );

  assertSameCollege(membership.collegeId, reviewer.collegeId);

  const canManageAny = roleHasPermission(reviewer.role as never, 'club:manage_members');
  const isPresident = membership.club.presidentId === reviewer.id;

  if (!isPresident && !canManageAny) {
    throw new ForbiddenError('Only the club president or a coordinator can review requests');
  }

  if (membership.status !== 'PENDING') {
    throw new ConflictError(`This request has already been ${membership.status.toLowerCase()}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.clubMembership.update({
      where: { id: membershipId },
      data: {
        status: decision.status,
        role: (decision.role as never) ?? 'MEMBER',
        reviewNote: decision.reviewNote ? sanitizeText(decision.reviewNote, 500) : null,
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        joinedAt: decision.status === 'ACTIVE' ? new Date() : null,
      },
    });

    // Only an approval changes the member count.
    if (decision.status === 'ACTIVE') {
      await tx.club.update({
        where: { id: membership.clubId },
        data: { memberCount: { increment: 1 } },
      });
    }
  });

  await notify({
    userId: membership.userId,
    type: 'CLUB_MEMBERSHIP',
    title: decision.status === 'ACTIVE' ? `You joined ${membership.club.name}` : `Request declined`,
    body:
      decision.status === 'ACTIVE'
        ? `Your membership in ${membership.club.name} is confirmed.`
        : `Your request to join ${membership.club.name} was not accepted.${decision.reviewNote ? ` Note: ${decision.reviewNote}` : ''}`,
    actionUrl: `/clubs/${membership.clubId}`,
    dedupeKey: `club-review-${membershipId}`,
  });

  auditUpdate(
    context,
    'ClubMembership',
    membershipId,
    { status: membership.status },
    { status: decision.status, role: decision.role },
  );
}

/** Leaves a club. The member count is decremented only for active memberships. */
export async function leaveClub(
  clubId: string,
  userId: string,
  context: AuditContext,
): Promise<void> {
  const membership = await prisma.clubMembership.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { id: true, status: true, role: true },
  });

  if (!membership) throw new NotFoundError('Membership');
  if (membership.status === 'LEFT') throw new ConflictError('You have already left this club');

  // The president cannot leave without handing over — an orphaned club would have
  // no one able to review requests or edit it.
  if (membership.role === 'PRESIDENT') {
    throw new ConflictError('Transfer the presidency to another member before leaving');
  }

  await prisma.$transaction(async (tx) => {
    await tx.clubMembership.update({
      where: { id: membership.id },
      data: { status: 'LEFT', deletedAt: new Date() },
    });

    if (membership.status === 'ACTIVE') {
      // Guard against going negative if the count was already out of step.
      await tx.club.updateMany({
        where: { id: clubId, memberCount: { gt: 0 } },
        data: { memberCount: { decrement: 1 } },
      });
    }
  });

  auditUpdate(context, 'ClubMembership', membership.id, { status: membership.status }, { status: 'LEFT' });
}

/** Pending requests for the clubs the caller manages. */
export async function listPendingRequests(
  caller: { id: string; collegeId: string | null; role: string; isSuperAdmin: boolean },
  filters: { page?: number; pageSize?: number; clubId?: string },
) {
  const pagination = normalisePagination(filters);

  const canManageAny = roleHasPermission(caller.role as never, 'club:manage_members');

  const where: Prisma.ClubMembershipWhereInput = {
    status: 'PENDING',
    deletedAt: null,
    ...(caller.isSuperAdmin ? {} : { collegeId: caller.collegeId }),
    ...(filters.clubId ? { clubId: filters.clubId } : {}),
    // A club lead sees only their own clubs' requests.
    ...(!canManageAny ? { club: { presidentId: caller.id } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.clubMembership.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        role: true,
        status: true,
        message: true,
        createdAt: true,
        club: { select: { id: true, name: true, slug: true, logoUrl: true } },
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            username: true,
            email: true,
            department: { select: { name: true, code: true } },
            studentProfile: { select: { graduationYear: true, readinessScore: true, rollNumber: true } },
          },
        },
      },
    }),
    prisma.clubMembership.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/** Every membership row, for the club management screen. */
export async function listMembers(
  clubId: string,
  filters: { page?: number; pageSize?: number; status?: string; role?: string; search?: string },
) {
  const pagination = normalisePagination(filters);

  const where: Prisma.ClubMembershipWhereInput = {
    clubId,
    deletedAt: null,
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.role ? { role: filters.role as never } : {}),
    ...(filters.search
      ? { user: { fullName: { contains: filters.search, mode: 'insensitive' } } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.clubMembership.findMany({
      where,
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        role: true,
        status: true,
        joinedAt: true,
        message: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            username: true,
            email: true,
            department: { select: { code: true } },
          },
        },
      },
    }),
    prisma.clubMembership.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/** Recomputes a club's member and event counters from the source rows. */
export async function refreshCounters(clubId: string): Promise<void> {
  const [memberCount, eventCount] = await Promise.all([
    prisma.clubMembership.count({ where: { clubId, status: 'ACTIVE', deletedAt: null } }),
    prisma.event.count({ where: { clubId, deletedAt: null } }),
  ]);

  await prisma.club.update({ where: { id: clubId }, data: { memberCount, eventCount } });
  logger.debug('Club counters refreshed', { clubId, memberCount, eventCount });
}
