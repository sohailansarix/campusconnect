import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  assertFound,
} from '../../utils/errors.js';
import { buildOrderBy, normalisePagination, paginated } from '../../utils/pagination.js';
import { sanitizeMultilineText } from '../../utils/sanitize.js';
import { auditCreate, auditUpdate, type AuditContext } from '../../utils/audit.js';

/**
 * Event feedback service.
 *
 * Feedback is gated on attendance, not registration. A student who registered but
 * did not turn up has nothing to rate, and allowing them to submit would let an
 * organiser's rivals depress a rating at scale.
 *
 * On anonymity: `anonymous` hides the author's name in every read path, but the
 * `authorId` column is retained so abuse can be traced by an administrator. This
 * is disclosed in the UI copy — a promise of true anonymity that the system does
 * not keep would be worse than no promise.
 */

const FEEDBACK_SELECT = {
  id: true,
  rating: true,
  contentRating: true,
  speakerRating: true,
  organizationRating: true,
  comment: true,
  suggestions: true,
  wouldRecommend: true,
  anonymous: true,
  isHidden: true,
  createdAt: true,
  author: {
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      username: true,
      department: { select: { code: true } },
    },
  },
} satisfies Prisma.FeedbackSelect;

type RawFeedback = Prisma.FeedbackGetPayload<{ select: typeof FEEDBACK_SELECT }>;

/**
 * Applies the anonymity rule and hides the hidden.
 *
 * `viewerCanModerate` reveals the author of an anonymous entry so a coordinator can
 * act on abuse. Everyone else sees no author at all — not a masked name, which
 * would still leak identity through uniqueness.
 */
function shape(
  feedback: RawFeedback,
  viewer: { id?: string; canModerate: boolean },
): Omit<RawFeedback, 'author'> & {
  author: RawFeedback['author'] | null;
  isMine: boolean;
  canEdit: boolean;
} {
  const isMine = feedback.author.id === viewer.id;
  const revealAuthor = !feedback.anonymous || viewer.canModerate || isMine;

  return {
    ...feedback,
    author: revealAuthor
      ? isMine || !feedback.anonymous
        ? {
            ...feedback.author,
            // The author viewing their own anonymous entry still gets their own
            // name back, so the UI can show "you wrote this".
            fullName: feedback.anonymous && isMine ? `${feedback.author.fullName} (you)` : feedback.author.fullName,
          }
        : feedback.author
      : null,
    isMine,
    canEdit: isMine,
  };
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

export type CreateFeedbackInput = {
  rating: number;
  contentRating?: number;
  speakerRating?: number;
  organizationRating?: number;
  comment?: string;
  suggestions?: string;
  wouldRecommend?: boolean;
  anonymous: boolean;
};

export async function create(
  eventId: string,
  authorId: string,
  input: CreateFeedbackInput,
  context: AuditContext,
) {
  const event = assertFound(
    await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        collegeId: true,
        status: true,
        organizerId: true,
        startAt: true,
        endAt: true,
        averageRating: true,
        feedbackCount: true,
      },
    }),
    'Event',
  );

  if (event.collegeId !== context.collegeId && !context.userId) {
    throw new ForbiddenError('You can only review events at your own college');
  }

  // Feedback opens once the event has started. Rating a workshop before it happens
  // is not meaningful, and it is an obvious way to game an average.
  if (event.status === 'DRAFT' || event.status === 'PENDING_FACULTY' || event.status === 'PENDING_ADMIN') {
    throw new ConflictError('This event has not happened yet');
  }
  if (event.startAt > new Date()) {
    throw new ConflictError('You can leave feedback once the event has started');
  }

  // Attendance gate.
  const attendance = await prisma.attendance.findFirst({
    where: { eventId, studentId: authorId, revokedAt: null },
    select: { id: true },
  });

  if (!attendance) {
    throw new ForbiddenError('Only students who attended this event can leave feedback');
  }

  const existing = await prisma.feedback.findUnique({
    where: { eventId_authorId: { eventId, authorId } },
    select: { id: true },
  });

  if (existing) throw new ConflictError('You have already reviewed this event');

  const feedback = await prisma.$transaction(async (tx) => {
    const created = await tx.feedback.create({
      data: {
        eventId,
        authorId,
        collegeId: event.collegeId,
        rating: input.rating,
        contentRating: input.contentRating ?? input.rating,
        speakerRating: input.speakerRating ?? input.rating,
        organizationRating: input.organizationRating ?? input.rating,
        comment: input.comment ? sanitizeMultilineText(input.comment, 2000) : null,
        suggestions: input.suggestions ? sanitizeMultilineText(input.suggestions, 2000) : null,
        wouldRecommend: input.wouldRecommend ?? null,
        anonymous: input.anonymous,
      },
      select: FEEDBACK_SELECT,
    });

    // Recompute the cached average inside the transaction so the event card and
    // the analytics summary never disagree.
    const aggregate = await tx.feedback.aggregate({
      where: { eventId, isHidden: false, deletedAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await tx.event.update({
      where: { id: eventId },
      data: {
        averageRating: aggregate._avg.rating ?? null,
        feedbackCount: aggregate._count.rating,
      },
    });

    return created;
  });

  auditCreate(context, 'Feedback', feedback.id, { eventId, rating: input.rating, anonymous: input.anonymous });

  logger.debug('Event feedback recorded', { eventId, rating: input.rating });

  return shape(feedback, { id: authorId, canModerate: false });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Lists feedback for an event.
 *
 * An anonymous flag on the row is not enough on its own: the organiser sees the
 * full list but the *public* event page must not. `viewerCanModerate` controls
 * whether hidden entries and anonymous authors are revealed.
 */
export async function listForEvent(
  eventId: string,
  filters: { page?: number; pageSize?: number; minRating?: number; maxRating?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' },
  viewer: { id?: string; canModerate: boolean },
) {
  const pagination = normalisePagination(filters);

  const where: Prisma.FeedbackWhereInput = {
    eventId,
    deletedAt: null,
    ...(viewer.canModerate ? {} : { isHidden: false }),
    ...(filters.minRating || filters.maxRating
      ? {
          rating: {
            ...(filters.minRating ? { gte: filters.minRating } : {}),
            ...(filters.maxRating ? { lte: filters.maxRating } : {}),
          },
        }
      : {}),
  };

  const [items, total, summary] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: buildOrderBy(filters.sortBy, filters.sortOrder, ['createdAt', 'rating'] as const, 'createdAt', 'desc'),
      skip: pagination.skip,
      take: pagination.take,
      select: FEEDBACK_SELECT,
    }),
    prisma.feedback.count({ where }),
    summarise(eventId),
  ]);

  return {
    ...paginated(items.map((item) => shape(item, viewer)), total, pagination),
    summary,
  };
}

/** The caller's own feedback for an event, so the UI can show what they wrote. */
export async function getMine(eventId: string, authorId: string) {
  const feedback = await prisma.feedback.findUnique({
    where: { eventId_authorId: { eventId, authorId } },
    select: FEEDBACK_SELECT,
  });

  if (!feedback) throw new NotFoundError('Feedback');
  return shape(feedback, { id: authorId, canModerate: false });
}

/** Aggregate summary for the organiser's analytics panel. */
export async function summarise(eventId: string) {
  const [aggregate, distribution, responses] = await Promise.all([
    prisma.feedback.aggregate({
      where: { eventId, isHidden: false, deletedAt: null },
      _avg: {
        rating: true,
        contentRating: true,
        speakerRating: true,
        organizationRating: true,
      },
      _count: { rating: true },
    }),
    prisma.feedback.groupBy({
      by: ['rating'],
      where: { eventId, isHidden: false, deletedAt: null },
      _count: { rating: true },
    }),
    prisma.feedback.findMany({
      where: { eventId, isHidden: false, deletedAt: null, suggestions: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { suggestions: true, rating: true },
    }),
  ]);

  const total = aggregate._count.rating;

  const recommendCount = await prisma.feedback.count({
    where: { eventId, isHidden: false, deletedAt: null, wouldRecommend: true },
  });

  return {
    responses: total,
    averageRating: aggregate._avg.rating ? Math.round(Number(aggregate._avg.rating) * 100) / 100 : null,
    averages: {
      content: aggregate._avg.contentRating ? Math.round(Number(aggregate._avg.contentRating) * 10) / 10 : null,
      speaker: aggregate._avg.speakerRating ? Math.round(Number(aggregate._avg.speakerRating) * 10) / 10 : null,
      organisation: aggregate._avg.organizationRating
        ? Math.round(Number(aggregate._avg.organizationRating) * 10) / 10
        : null,
    },
    distribution: [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: distribution.find((d) => d.rating === rating)?._count.rating ?? 0,
      percentage:
        total > 0
          ? Math.round(((distribution.find((d) => d.rating === rating)?._count.rating ?? 0) / total) * 100)
          : 0,
    })),
    recommendRate: total > 0 ? Math.round((recommendCount / total) * 100) : null,
    // The suggestions field is only visible here, never on the public page.
    topSuggestions: responses
      .map((r) => r.suggestions)
      .filter((s): s is string => Boolean(s && s.trim().length > 0)),
  };
}

/** Registrations that attended but have not left feedback — powers reminders. */
export async function pendingFeedback(eventId: string, collegeId: string | null) {
  const registrations = await prisma.eventRegistration.findMany({
    where: {
      eventId,
      status: 'ATTENDED',
      feedback: undefined,
      ...(collegeId ? { collegeId } : {}),
    },
    select: {
      id: true,
      student: { select: { id: true, fullName: true, email: true } },
    },
    take: 1000,
  });

  // `feedback` is a relation on Event (not on EventRegistration), so the "not yet
  // submitted" check needs its own query.
  const authors = await prisma.feedback.findMany({
    where: { eventId },
    select: { authorId: true },
  });
  const submitted = new Set(authors.map((a) => a.authorId));

  return registrations.filter((r) => !submitted.has(r.student.id));
}

/* -------------------------------------------------------------------------- */
/* Moderation & edit                                                          */
/* -------------------------------------------------------------------------- */

/** The author may edit their own feedback for 7 days after submitting. */
export async function updateMine(
  eventId: string,
  authorId: string,
  input: Partial<CreateFeedbackInput>,
  context: AuditContext,
) {
  const existing = assertFound(
    await prisma.feedback.findUnique({
      where: { eventId_authorId: { eventId, authorId } },
      select: { id: true, createdAt: true, rating: true },
    }),
    'Feedback',
  );

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - existing.createdAt.getTime() > sevenDaysMs) {
    throw new ConflictError('Feedback can only be edited within 7 days of submitting it');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.feedback.update({
      where: { id: existing.id },
      data: {
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.contentRating !== undefined ? { contentRating: input.contentRating } : {}),
        ...(input.speakerRating !== undefined ? { speakerRating: input.speakerRating } : {}),
        ...(input.organizationRating !== undefined
          ? { organizationRating: input.organizationRating }
          : {}),
        ...(input.comment !== undefined
          ? { comment: input.comment ? sanitizeMultilineText(input.comment, 2000) : null }
          : {}),
        ...(input.suggestions !== undefined
          ? { suggestions: input.suggestions ? sanitizeMultilineText(input.suggestions, 2000) : null }
          : {}),
        ...(input.wouldRecommend !== undefined ? { wouldRecommend: input.wouldRecommend } : {}),
        ...(input.anonymous !== undefined ? { anonymous: input.anonymous } : {}),
      },
      select: FEEDBACK_SELECT,
    });

    const aggregate = await tx.feedback.aggregate({
      where: { eventId, isHidden: false, deletedAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await tx.event.update({
      where: { id: eventId },
      data: { averageRating: aggregate._avg.rating ?? null, feedbackCount: aggregate._count.rating },
    });

    return row;
  });

  auditUpdate(context, 'Feedback', existing.id, { rating: existing.rating }, { rating: updated.rating });

  return shape(updated, { id: authorId, canModerate: false });
}

/**
 * Hides or restores feedback.
 *
 * Hidden rather than deleted: the organiser needs to stop an abusive comment
 * appearing publicly without destroying the evidence an administrator would need.
 */
export async function setHidden(
  feedbackId: string,
  hidden: boolean,
  reason: string | undefined,
  actor: { id: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<void> {
  const feedback = assertFound(
    await prisma.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true, collegeId: true, eventId: true, isHidden: true },
    }),
    'Feedback',
  );

  if (!actor.isSuperAdmin && feedback.collegeId !== actor.collegeId) {
    throw new ForbiddenError('That feedback belongs to another institution');
  }

  await prisma.$transaction(async (tx) => {
    await tx.feedback.update({
      where: { id: feedbackId },
      data: { isHidden: hidden, hiddenReason: hidden ? (reason ?? 'Hidden by a moderator') : null },
    });

    // A hidden review must not count toward the public average.
    const aggregate = await tx.feedback.aggregate({
      where: { eventId: feedback.eventId, isHidden: false, deletedAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await tx.event.update({
      where: { id: feedback.eventId },
      data: { averageRating: aggregate._avg.rating ?? null, feedbackCount: aggregate._count.rating },
    });
  });

  auditUpdate(context, 'Feedback', feedbackId, { isHidden: feedback.isHidden }, { isHidden: hidden }, { reason });
}

/** The event's public reviews, with anonymous authors stripped. */
export async function listPublic(eventId: string, limit = 6) {
  const feedback = await prisma.feedback.findMany({
    where: { eventId, isHidden: false, deletedAt: null, comment: { not: null } },
    orderBy: { rating: 'desc' },
    take: limit,
    select: {
      id: true,
      rating: true,
      comment: true,
      anonymous: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          department: { select: { code: true } },
        },
      },
    },
  });

  return feedback.map((entry) => ({
    id: entry.id,
    rating: entry.rating,
    comment: entry.comment,
    createdAt: entry.createdAt,
    author: entry.anonymous
      ? { id: null, fullName: 'Anonymous student', avatarUrl: null, departmentCode: null }
      : {
          id: entry.author.id,
          fullName: entry.author.fullName,
          avatarUrl: entry.author.avatarUrl,
          departmentCode: entry.author.department?.code ?? null,
        },
  }));
}
