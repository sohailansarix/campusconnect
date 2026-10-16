import type { Prisma } from '@prisma/client';
import { READINESS_BANDS, readinessBand } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { ForbiddenError, assertFound } from '../../utils/errors.js';

/**
 * Analytics service.
 *
 * Every figure here is computed from the event, registration and attendance rows
 * rather than from a pre-aggregated table. That keeps the numbers traceable — an
 * administrator asking "why does this say 340?" can be answered by pointing at a
 * query — which matters far more than speed at the pilot's scale (one college,
 * 500–2000 students).
 *
 * Two rules that shape the implementation:
 *
 *  * **Every read is college-scoped.** `scopeFor()` centralises this so a new
 *    endpoint cannot forget it. A super admin passes `null` and sees everything;
 *    everyone else is constrained to their own `collegeId`.
 *
 *  * **Attendance is the denominator for engagement, not registration.** A student
 *    who registered and did not turn up is not engaged, so every participation
 *    metric reads from `Attendance` with `revokedAt: null`.
 *
 * TODO(Phase 4): materialise these into a nightly rollup once the platform passes
 * roughly 50k attendance rows per college.
 */

/* -------------------------------------------------------------------------- */
/* Scoping                                                                    */
/* -------------------------------------------------------------------------- */

export type AnalyticsScope = {
  collegeId: string | null;
  isSuperAdmin: boolean;
  /** Restricts student-facing metrics to one department. */
  departmentId?: string | null;
};

/**
 * Builds the college filter used by every query in this module.
 *
 * Returns an empty object only for a super admin with no explicit college filter.
 * A non-super-admin with a null collegeId would otherwise see the whole platform,
 * so that case is rejected rather than silently widened.
 */
function scopeFor(scope: AnalyticsScope, explicitCollegeId?: string): Prisma.EventWhereInput['collegeId'] extends never ? never : Record<string, unknown> {
  if (scope.isSuperAdmin) {
    return explicitCollegeId ? { collegeId: explicitCollegeId } : {};
  }
  if (!scope.collegeId) {
    throw new ForbiddenError('Your account is not linked to a college');
  }
  return { collegeId: scope.collegeId };
}

/** Same idea, for user-scoped queries. */
function userScope(scope: AnalyticsScope): Prisma.UserWhereInput {
  if (scope.isSuperAdmin) {
    return scope.collegeId ? { collegeId: scope.collegeId } : {};
  }
  if (!scope.collegeId) throw new ForbiddenError('Your account is not linked to a college');
  return { collegeId: scope.collegeId };
}

/** Inclusive date window, defaulting to the trailing 90 days. */
function resolveRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  return { from: start, to: end };
}

/**
 * Bucket key for a date, at the requested granularity.
 *
 * Computed in SQL rather than in JavaScript so the database can group without
 * shipping every row. Dates are shifted to IST before truncating, because a month
 * boundary computed in UTC puts an event held at 02:00 IST on the 1st into the
 * previous month.
 */
function bucketExpression(granularity: 'DAY' | 'WEEK' | 'MONTH', column: string): Prisma.Sql {
  const shifted = Prisma.raw(`(${column} AT TIME ZONE 'Asia/Kolkata')`);
  switch (granularity) {
    case 'DAY':
      return Prisma.sql`to_char(date_trunc('day', ${shifted}), 'YYYY-MM-DD')`;
    case 'WEEK':
      return Prisma.sql`to_char(date_trunc('week', ${shifted}), 'YYYY-MM-DD')`;
    case 'MONTH':
    default:
      return Prisma.sql`to_char(date_trunc('month', ${shifted}), 'YYYY-MM')`;
  }
}

/* -------------------------------------------------------------------------- */
/* Overview KPIs                                                              */
/* -------------------------------------------------------------------------- */

export type CollegeOverview = {
  students: {
    total: number;
    active: number;
    byYear: { year: number; count: number }[];
    byDepartment: { departmentId: string | null; name: string; code: string; count: number }[];
  };
  events: {
    total: number;
    published: number;
    completed: number;
    upcoming: number;
    registrations: number;
    attendance: number;
    attendanceRate: number;
  };
  certificates: { issued: number; revoked: number; thisMonth: number };
  clubs: { total: number; members: number; active: number };
  readiness: { average: number; distribution: { band: string; count: number }[] };
  engagement: { participationRate: number; activeStudents: number; dormantStudents: number };
};

export async function collegeOverview(
  scope: AnalyticsScope,
  range: { from?: Date; to?: Date } = {},
): Promise<CollegeOverview> {
  const { from, to } = resolveRange(range.from, range.to);
  const collegeFilter = scopeFor(scope);

  const studentWhere: Prisma.UserWhereInput = {
    ...userScope(scope),
    role: 'STUDENT',
    deletedAt: null,
    ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
  };

  const eventWhere: Prisma.EventWhereInput = { ...collegeFilter, deletedAt: null };

  const [
    totalStudents,
    activeStudents,
    eventsByStatus,
    registrationCount,
    attendanceCount,
    certificatesIssued,
    certificatesRevoked,
    certificatesThisMonth,
    clubStats,
    readinessAgg,
    byDepartment,
    byYear,
    attendanceByStudent,
  ] = await Promise.all([
    prisma.user.count({ where: studentWhere }),

    prisma.user.count({ where: { ...studentWhere, status: 'ACTIVE' } }),

    prisma.event.groupBy({
      by: ['status'],
      where: eventWhere,
      _count: { status: true },
    }),

    prisma.eventRegistration.count({
      where: {
        event: { ...collegeFilter, deletedAt: null, startAt: { gte: from, lte: to } },
        status: { not: 'CANCELLED' },
      },
    }),

    prisma.attendance.count({
      where: {
        revokedAt: null,
        event: { ...collegeFilter, deletedAt: null, startAt: { gte: from, lte: to } },
      },
    }),

    prisma.certificate.count({
      where: { ...collegeFilter, status: 'ISSUED', deletedAt: null },
    }),

    prisma.certificate.count({
      where: { ...collegeFilter, status: 'REVOKED', deletedAt: null },
    }),

    prisma.certificate.count({
      where: {
        ...collegeFilter,
        status: 'ISSUED',
        deletedAt: null,
        issuedAt: { gte: startOfMonth(new Date()), lte: new Date() },
      },
    }),

    Promise.all([
      prisma.club.count({ where: { ...collegeFilter, deletedAt: null, isActive: true } }),
      prisma.clubMembership.count({
        where: { ...collegeFilter, status: 'ACTIVE', deletedAt: null },
      }),
    ]),

    prisma.studentProfile.aggregate({
      where: {
        deletedAt: null,
        user: { ...studentWhere },
      },
      _avg: { readinessScore: true },
      _count: { readinessScore: true },
    }),

    prisma.department.findMany({
      where: { collegeId: scope.collegeId ?? undefined, deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        _count: { select: { users: { where: { role: 'STUDENT', deletedAt: null } } } },
      },
    }),

    prisma.user.groupBy({
      by: ['studentProfileId'],
      where: { ...studentWhere, studentProfile: { isNot: null } },
      _count: { _all: true },
    }),

    // Per-student attendance counts, used for the dormant/active split below.
    prisma.attendance.groupBy({
      by: ['studentId'],
      where: {
        revokedAt: null,
        student: { ...studentWhere },
        event: { startAt: { gte: from, lte: to } },
      },
      _count: { studentId: true },
    }),
  ]);

  const eventsByStatusMap = new Map(eventsByStatus.map((row) => [row.status, row._count.status]));
  const totalEvents = eventsByStatus.reduce((sum, row) => sum + row._count.status, 0);
  const upcomingEvents = await prisma.event.count({
    where: { ...eventWhere, status: 'PUBLISHED', startAt: { gt: new Date() } },
  });

  // Graduation years are stored on the profile, so the year-of-study breakdown
  // needs one query per distinct graduation year rather than a groupBy on User.
  const graduationYears = await prisma.studentProfile.groupBy({
    by: ['graduationYear'],
    where: { deletedAt: null, user: studentWhere },
    _count: { graduationYear: true },
  });

  const currentYear = new Date().getFullYear();
  const byYearBuckets = graduationYears
    .filter((row) => row.graduationYear !== null)
    .map((row) => {
      const yearOfStudy = Math.max(1, Math.min(6, 5 - (row.graduationYear! - currentYear)));
      return { year: yearOfStudy, count: row._count.graduationYear };
    })
    .reduce<{ year: number; count: number }[]>((accumulator, entry) => {
      const existing = accumulator.find((a) => a.year === entry.year);
      if (existing) existing.count += entry.count;
      else accumulator.push({ ...entry });
      return accumulator;
    }, [])
    .sort((a, b) => a.year - b.year);

  // Readiness distribution across the shared bands, so the chart colours match the
  // badge a student sees on their own passport.
  const readinessBuckets = await Promise.all(
    READINESS_BANDS.map(async (band, index) => {
      const upper = index === 0 ? 100 : READINESS_BANDS[index - 1]!.min - 1;
      const count = await prisma.studentProfile.count({
        where: {
          deletedAt: null,
          user: studentWhere,
          readinessScore: { gte: band.min, lte: upper },
        },
      });
      return { band: band.label, count };
    }),
  );

  const studentsWithAttendance = attendanceByStudent.length;
  const activeParticipantCount = attendanceByStudent.filter((row) => row._count.studentId >= 2).length;

  return {
    students: {
      total: totalStudents,
      active: activeStudents,
      byYear: byYearBuckets,
      byDepartment: byDepartment.map((department) => ({
        departmentId: department.id,
        name: department.name,
        code: department.code,
        count: department._count.users,
      })),
    },
    events: {
      total: totalEvents,
      published: eventsByStatusMap.get('PUBLISHED') ?? 0,
      completed: eventsByStatusMap.get('COMPLETED') ?? 0,
      upcoming: upcomingEvents,
      registrations: registrationCount,
      attendance: attendanceCount,
      // Attendance rate is measured against registrations in the same window, so
      // the two numbers always describe the same population.
      attendanceRate: registrationCount > 0 ? Math.round((attendanceCount / registrationCount) * 100) : 0,
    },
    certificates: {
      issued: certificatesIssued,
      revoked: certificatesRevoked,
      thisMonth: certificatesThisMonth,
    },
    clubs: {
      total: clubStats[0],
      members: clubStats[1],
      active: clubStats[0],
    },
    readiness: {
      average: readinessAgg._avg.readinessScore ? Math.round(readinessAgg._avg.readinessScore) : 0,
      distribution: readinessBuckets,
    },
    engagement: {
      participationRate: totalStudents > 0 ? Math.round((studentsWithAttendance / totalStudents) * 100) : 0,
      // "Active" means attended at least two events — one attendance is often a
      // compulsory induction, which is not evidence of engagement.
      activeStudents: activeParticipantCount,
      dormantStudents: Math.max(0, totalStudents - studentsWithAttendance),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Event engagement                                                           */
/* -------------------------------------------------------------------------- */

export async function eventEngagement(
  scope: AnalyticsScope,
  params: {
    from?: Date;
    to?: Date;
    granularity: 'DAY' | 'WEEK' | 'MONTH';
    eventId?: string;
    category?: string[];
  },
) {
  const { from, to } = resolveRange(params.from, params.to);
  const collegeFilter = scopeFor(scope);

  const eventWhere: Prisma.EventWhereInput = {
    ...collegeFilter,
    deletedAt: null,
    startAt: { gte: from, lte: to },
    ...(params.eventId ? { id: params.eventId } : {}),
    ...(params.category && params.category.length > 0 ? { category: { in: params.category as never } } : {}),
  };

  const [totals, seriesRaw, byCategoryRaw, feedbackAgg] = await Promise.all([
    Promise.all([
      prisma.event.count({ where: eventWhere }),
      prisma.eventRegistration.count({ where: { event: eventWhere, status: { not: 'CANCELLED' } } }),
      prisma.attendance.count({ where: { revokedAt: null, event: eventWhere } }),
      prisma.certificate.count({ where: { status: 'ISSUED', deletedAt: null, event: eventWhere } }),
    ]),

    /**
     * Registrations and attendance bucketed together.
     *
     * A `UNION ALL` of two grouped queries, so a bucket where only one side has
     * rows still appears — which is the whole point of a registration-vs-attendance
     * chart (a spike in registrations with no matching attendance is the signal).
     */
    prisma.$queryRaw<{ bucket: string; kind: string; count: bigint }[]>`
      SELECT bucket, 'registrations' AS kind, COUNT(*) AS count FROM (
        SELECT ${bucketExpression(params.granularity, 'e."startAt"')} AS bucket
        FROM event_registrations r
        JOIN events e ON e.id = r."eventId"
        WHERE e."collegeId" = COALESCE(${scope.collegeId}, e."collegeId")
          AND e."deletedAt" IS NULL
          AND e."startAt" BETWEEN ${from} AND ${to}
          AND r.status <> 'CANCELLED'
      ) t GROUP BY bucket
      UNION ALL
      SELECT bucket, 'attendance' AS kind, COUNT(*) AS count FROM (
        SELECT ${bucketExpression(params.granularity, 'e."startAt"')} AS bucket
        FROM attendances a
        JOIN events e ON e.id = a."eventId"
        WHERE e."collegeId" = COALESCE(${scope.collegeId}, e."collegeId")
          AND e."deletedAt" IS NULL
          AND e."startAt" BETWEEN ${from} AND ${to}
          AND a."revokedAt" IS NULL
      ) t GROUP BY bucket
      ORDER BY bucket ASC
    `,

    prisma.event.groupBy({
      by: ['category'],
      where: eventWhere,
      _count: { category: true },
      _avg: { averageRating: true },
      _sum: { registrationCount: true, attendanceCount: true },
    }),

    prisma.feedback.aggregate({
      where: { event: eventWhere, isHidden: false, deletedAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    }),
  ]);

  const [eventCount, registrationCount, attendanceCount, certificatesIssued] = totals;

  // Merge the two UNION branches into one row per bucket.
  const seriesMap = new Map<string, { bucket: string; registrations: number; attendance: number }>();
  for (const row of seriesRaw) {
    const existing = seriesMap.get(row.bucket) ?? { bucket: row.bucket, registrations: 0, attendance: 0 };
    if (row.kind === 'registrations') existing.registrations = Number(row.count);
    else existing.attendance = Number(row.count);
    seriesMap.set(row.bucket, existing);
  }

  return {
    totals: {
      events: eventCount,
      registrations: registrationCount,
      attendance: attendanceCount,
      certificatesIssued,
      attendanceRate: registrationCount > 0 ? Math.round((attendanceCount / registrationCount) * 100) : 0,
      averageRating: feedbackAgg._avg.rating ? Math.round(Number(feedbackAgg._avg.rating) * 100) / 100 : null,
      feedbackResponses: feedbackAgg._count.rating,
    },
    registrationVsAttendance: [...seriesMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    popularCategories: byCategoryRaw
      .map((row) => {
        const registrations = row._sum.registrationCount ?? 0;
        const attendance = row._sum.attendanceCount ?? 0;
        return {
          category: row.category,
          count: row._count.category,
          registrations,
          attendance,
          attendanceRate: registrations > 0 ? Math.round((attendance / registrations) * 100) : 0,
          averageRating: row._avg.averageRating ? Math.round(Number(row._avg.averageRating) * 10) / 10 : null,
        };
      })
      .sort((a, b) => b.registrations - a.registrations),
  };
}

/* -------------------------------------------------------------------------- */
/* Participation breakdowns                                                   */
/* -------------------------------------------------------------------------- */

export async function participationBreakdown(
  scope: AnalyticsScope,
  range: { from?: Date; to?: Date } = {},
) {
  const { from, to } = resolveRange(range.from, range.to);
  const collegeFilter = scopeFor(scope);

  const eventWindow: Prisma.EventWhereInput = {
    ...collegeFilter,
    deletedAt: null,
    startAt: { gte: from, lte: to },
  };

  const [byDepartmentRaw, byYearRaw, clubActivityRaw] = await Promise.all([
    /**
     * Participation by department.
     *
     * Grouped on the *student's* department, read through the attendance row. Using
     * the event's department would attribute a college-wide fest to whichever
     * department organised it.
     */
    prisma.$queryRaw<{ departmentId: string | null; departmentName: string | null; code: string | null; participants: bigint; attendances: bigint }[]>`
      SELECT d.id AS "departmentId",
             d.name AS "departmentName",
             d.code AS code,
             COUNT(DISTINCT a."studentId") AS participants,
             COUNT(*) AS attendances
      FROM attendances a
      JOIN events e ON e.id = a."eventId"
      LEFT JOIN users u ON u.id = a."studentId"
      LEFT JOIN departments d ON d.id = u."departmentId"
      WHERE e."collegeId" = COALESCE(${scope.collegeId}, e."collegeId")
        AND e."deletedAt" IS NULL
        AND e."startAt" BETWEEN ${from} AND ${to}
        AND a."revokedAt" IS NULL
      GROUP BY d.id, d.name, d.code
      ORDER BY participants DESC
    `,

    prisma.$queryRaw<{ graduationYear: number | null; participants: bigint }[]>`
      SELECT sp."graduationYear" AS "graduationYear", COUNT(DISTINCT a."studentId") AS participants
      FROM attendances a
      JOIN events e ON e.id = a."eventId"
      LEFT JOIN student_profiles sp ON sp."userId" = a."studentId"
      WHERE e."collegeId" = COALESCE(${scope.collegeId}, e."collegeId")
        AND e."deletedAt" IS NULL
        AND e."startAt" BETWEEN ${from} AND ${to}
        AND a."revokedAt" IS NULL
      GROUP BY sp."graduationYear"
      ORDER BY sp."graduationYear" ASC
    `,

    prisma.club.findMany({
      where: { ...collegeFilter, deletedAt: null },
      select: {
        id: true,
        name: true,
        category: true,
        memberCount: true,
        _count: {
          select: {
            events: { where: { deletedAt: null, startAt: { gte: from, lte: to } } },
          },
        },
      },
      orderBy: { memberCount: 'desc' },
      take: 30,
    }),
  ]);

  // Total students per department, so engagement can be expressed as a rate rather
  // than a raw count — a large department always looks "most engaged" otherwise.
  const departmentTotals = await prisma.department.findMany({
    where: { collegeId: scope.collegeId ?? undefined, deletedAt: null },
    select: {
      id: true,
      _count: { select: { users: { where: { role: 'STUDENT', deletedAt: null } } } },
    },
  });
  const totalByDepartment = new Map(departmentTotals.map((d) => [d.id, d._count.users]));

  const currentYear = new Date().getFullYear();

  return {
    byDepartment: byDepartmentRaw.map((row) => {
      const total = row.departmentId ? (totalByDepartment.get(row.departmentId) ?? 0) : 0;
      const participants = Number(row.participants);

      /*
       * Engagement score blends reach and intensity:
       *   60% — what share of the department participated at least once
       *   40% — average events attended per participant, capped at 5
       * A department where everyone attended once scores higher than one where two
       * people attended ten times, which matches how a placement officer reads it.
       */
      const reach = total > 0 ? participants / total : 0;
      const intensity = participants > 0 ? Math.min(1, Number(row.attendances) / participants / 5) : 0;
      const engagementScore = Math.round((reach * 0.6 + intensity * 0.4) * 100);

      return {
        departmentId: row.departmentId,
        departmentName: row.departmentName ?? 'Unassigned',
        code: row.code ?? '—',
        participants,
        attendances: Number(row.attendances),
        totalStudents: total,
        engagementScore,
      };
    }),

    byYear: byYearRaw
      .filter((row) => row.graduationYear !== null)
      .map((row) => ({
        // Reported as year of study rather than graduation year — "second years
        // barely participate" is the actionable framing.
        year: Math.max(1, Math.min(6, 5 - (row.graduationYear! - currentYear))),
        graduationYear: row.graduationYear!,
        participants: Number(row.participants),
      }))
      .sort((a, b) => a.year - b.year),

    clubActivity: clubActivityRaw.map((club) => ({
      clubId: club.id,
      clubName: club.name,
      category: club.category,
      members: club.memberCount,
      events: club._count.events,
      eventsPerMember: club.memberCount > 0 ? Math.round((club._count.events / club.memberCount) * 100) / 100 : 0,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Individual engagement score                                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-student engagement score, 0–100.
 *
 * Weighted toward *breadth* of participation rather than raw volume, because the
 * platform's goal is a student who engages across categories, not one who attends
 * every session of a single club. Category diversity is therefore a first-class
 * term.
 *
 * Used for the student-engagement table and the CSV export. Not shown to students
 * themselves — an engagement score is an institutional instrument, and a student
 * seeing "your engagement is 34" is discouraging without being actionable.
 */
export async function studentEngagement(
  scope: AnalyticsScope,
  params: {
    page: number;
    pageSize: number;
    departmentId?: string;
    graduationYear?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  },
) {
  const collegeFilter = userScope(scope);

  const where: Prisma.UserWhereInput = {
    ...collegeFilter,
    role: 'STUDENT',
    deletedAt: null,
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.search
      ? {
          OR: [
            { fullName: { contains: params.search, mode: 'insensitive' } },
            { email: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(params.graduationYear ? { studentProfile: { graduationYear: params.graduationYear } } : {}),
  };

  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        username: true,
        department: { select: { id: true, name: true, code: true } },
        studentProfile: {
          select: {
            rollNumber: true,
            graduationYear: true,
            readinessScore: true,
            eventsAttended: true,
            certificatesEarned: true,
          },
        },
        _count: {
          select: {
            attendances: { where: { revokedAt: null } },
            registrations: true,
            certificates: { where: { status: 'ISSUED' } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const studentIds = students.map((s) => s.id);

  // One query for category diversity across the whole page, rather than one per
  // student.
  const categoriesByStudent = studentIds.length
    ? await prisma.attendance.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, revokedAt: null },
        _count: { _all: true },
      })
    : [];

  const distinctCategories = studentIds.length
    ? await prisma.$queryRaw<{ studentId: string; categories: bigint }[]>`
        SELECT a."studentId", COUNT(DISTINCT e.category) AS categories
        FROM attendances a
        JOIN events e ON e.id = a."eventId"
        WHERE a."studentId" IN (${Prisma.join(studentIds)})
          AND a."revokedAt" IS NULL
        GROUP BY a."studentId"
      `
    : [];

  const categoryMap = new Map(distinctCategories.map((row) => [row.studentId, Number(row.categories)]));

  const items = students.map((student) => {
    const attendances = student._count.attendances;
    const categories = categoryMap.get(student.id) ?? 0;

    // 50% volume (saturating at 10 events), 30% category breadth (saturating at 4),
    // 20% readiness contribution.
    const volume = Math.min(1, attendances / 10);
    const breadth = Math.min(1, categories / 4);
    const readiness = (student.studentProfile?.readinessScore ?? 0) / 100;

    const engagementScore = Math.round((volume * 0.5 + breadth * 0.3 + readiness * 0.2) * 100);

    return {
      id: student.id,
      fullName: student.fullName,
      email: student.email,
      avatarUrl: student.avatarUrl,
      username: student.username,
      department: student.department,
      rollNumber: student.studentProfile?.rollNumber ?? null,
      graduationYear: student.studentProfile?.graduationYear ?? null,
      readinessScore: student.studentProfile?.readinessScore ?? 0,
      eventsAttended: attendances,
      eventsRegistered: student._count.registrations,
      certificates: student._count.certificates,
      categoriesAttended: categories,
      // The gap between registered and attended is the useful signal — a student
      // with 10 registrations and 1 attendance has an attendance problem, not a
      // participation one.
      noShowRate: student._count.registrations > 0
        ? Math.round(((student._count.registrations - attendances) / student._count.registrations) * 100)
        : 0,
      engagementScore,
      band: engagementBand(engagementScore),
    };
  });

  const sorted = [...items].sort((a, b) => {
    const field = (params.sortBy as keyof typeof a) ?? 'engagementScore';
    const direction = params.sortOrder === 'asc' ? 1 : -1;
    const left = a[field];
    const right = b[field];
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });

  return {
    items: sorted,
    meta: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
      hasNext: params.page * params.pageSize < total,
      hasPrev: params.page > 1,
    },
  };
}

function engagementBand(score: number): string {
  if (score >= 70) return 'Highly engaged';
  if (score >= 45) return 'Engaged';
  if (score >= 20) return 'Occasional';
  return 'Dormant';
}

/* -------------------------------------------------------------------------- */
/* Readiness analytics                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Career-readiness view for the placement officer.
 *
 * Combines the readiness distribution with the skill gaps behind it, so the officer
 * can act on a number rather than just observe it: "68% of final years are below 60
 * readiness, and the dominant gap is SQL" is a training plan.
 */
export async function readinessAnalytics(
  scope: AnalyticsScope,
  range: { from?: Date; to?: Date; departmentId?: string; graduationYear?: number } = {},
) {
  const studentWhere: Prisma.UserWhereInput = {
    ...userScope(scope),
    role: 'STUDENT',
    deletedAt: null,
    ...(scope.departmentId || range.departmentId ? { departmentId: scope.departmentId ?? range.departmentId } : {}),
    ...(range.graduationYear ? { studentProfile: { graduationYear: range.graduationYear } } : {}),
  };

  const [distribution, average, byDepartment, topGaps, outcomeCounts] = await Promise.all([
    Promise.all(
      READINESS_BANDS.map(async (band, index) => {
        const upper = index === 0 ? 100 : READINESS_BANDS[index - 1]!.min - 1;
        const count = await prisma.studentProfile.count({
          where: {
            deletedAt: null,
            user: studentWhere,
            readinessScore: { gte: band.min, lte: upper },
          },
        });
        return { band: band.label, min: band.min, tone: band.tone, count };
      }),
    ),

    prisma.studentProfile.aggregate({
      where: { deletedAt: null, user: studentWhere },
      _avg: {
        readinessScore: true,
        readinessSkills: true,
        readinessProjects: true,
        readinessInternship: true,
        readinessInterview: true,
      },
      _count: { readinessScore: true },
    }),

    prisma.$queryRaw<{ departmentName: string; code: string; average: number; students: bigint; belowSixty: bigint }[]>`
      SELECT d.name AS "departmentName", d.code AS code,
             ROUND(AVG(sp."readinessScore"))::int AS average,
             COUNT(*) AS students,
             COUNT(*) FILTER (WHERE sp."readinessScore" < 60) AS "belowSixty"
      FROM student_profiles sp
      JOIN users u ON u.id = sp."userId"
      LEFT JOIN departments d ON d.id = u."departmentId"
      WHERE u."collegeId" = COALESCE(${scope.collegeId}, u."collegeId")
        AND u."deletedAt" IS NULL
        AND u.role = 'STUDENT'
      GROUP BY d.name, d.code
      ORDER BY average ASC
    `,

    /**
     * The dominant skill gaps.
     *
     * "Gap" is defined as a skill the student holds below INTERMEDIATE, or does not
     * hold at all, among the skills this college's employers actually ask for
     * (counted through JobSkill). That keeps the report tied to hiring demand rather
     * than to an arbitrary skill catalogue.
     */
    prisma.$queryRaw<{ skillName: string; categoryName: string; studentsAffected: bigint; demand: bigint }[]>`
      SELECT s.name AS "skillName",
             sc.name AS "categoryName",
             COUNT(DISTINCT u.id) AS "studentsAffected",
             COUNT(DISTINCT js."jobId") AS demand
      FROM job_skills js
      JOIN skills s ON s.id = js."skillId"
      JOIN skill_categories sc ON sc.id = s."categoryId"
      JOIN users u ON u."collegeId" = COALESCE(${scope.collegeId}, u."collegeId")
        AND u.role = 'STUDENT' AND u."deletedAt" IS NULL
      LEFT JOIN student_profiles sp ON sp."userId" = u.id
      LEFT JOIN student_skills ss ON ss."studentProfileId" = sp.id AND ss."skillId" = s.id
      WHERE js.required = true
        AND (ss.id IS NULL OR ss.score < 50)
      GROUP BY s.name, sc.name
      HAVING COUNT(DISTINCT u.id) > 0
      ORDER BY "studentsAffected" DESC, demand DESC
      LIMIT 15
    `,

    prisma.application.groupBy({
      by: ['status'],
      where: {
        ...(scope.collegeId ? { collegeId: scope.collegeId } : {}),
        deletedAt: null,
      },
      _count: { status: true },
    }),
  ]);

  const outcomeMap = new Map(outcomeCounts.map((row) => [row.status, row._count.status]));
  const totalApplications = outcomeCounts.reduce((sum, row) => sum + row._count.status, 0);

  return {
    distribution,
    totals: {
      students: average._count.readinessScore,
      average: average._avg.readinessScore ? Math.round(average._avg.readinessScore) : 0,
      pillars: {
        skills: Math.round(average._avg.readinessSkills ?? 0),
        projects: Math.round(average._avg.readinessProjects ?? 0),
        internship: Math.round(average._avg.readinessInternship ?? 0),
        interview: Math.round(average._avg.readinessInterview ?? 0),
      },
    },
    byDepartment: byDepartment.map((row) => ({
      departmentName: row.departmentName ?? 'Unassigned',
      code: row.code ?? '—',
      averageScore: row.average,
      students: Number(row.students),
      belowSixty: Number(row.belowSixty),
      atRiskPercentage:
        Number(row.students) > 0 ? Math.round((Number(row.belowSixty) / Number(row.students)) * 100) : 0,
    })),
    topGaps: topGaps.map((row) => ({
      skillName: row.skillName,
      categoryName: row.categoryName,
      studentsAffected: Number(row.studentsAffected),
      employerDemand: Number(row.demand),
    })),
    placementFunnel: buildFunnel(outcomeMap, totalApplications),
  };
}

/* -------------------------------------------------------------------------- */
/* Placement funnel                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Builds the placement funnel.
 *
 * Counts are cumulative — a student who reached OFFER also passed SHORTLISTED —
 * because a non-cumulative funnel that appears to narrow and widen is unreadable.
 * REJECTED and WITHDRAWN are reported separately as exits rather than as stages.
 */
export function buildFunnel(outcomeMap: Map<string, number>, total: number) {
  const stages = [
    { key: 'APPLIED', label: 'Applied' },
    { key: 'UNDER_REVIEW', label: 'Under Review' },
    { key: 'SHORTLISTED', label: 'Shortlisted' },
    { key: 'INTERVIEW_SCHEDULED', label: 'Interview' },
    { key: 'OFFER', label: 'Offer' },
    { key: 'HIRED', label: 'Hired' },
  ];

  const order = [
    'APPLIED',
    'UNDER_REVIEW',
    'SHORTLISTED',
    'INTERVIEW_SCHEDULED',
    'INTERVIEWED',
    'OFFER',
    'HIRED',
  ];

  return {
    stages: stages.map((stage) => {
      const index = order.indexOf(stage.key);
      // Cumulative: everything at or past this stage in the pipeline.
      const reached = order
        .slice(index)
        .reduce((sum, key) => sum + (outcomeMap.get(key) ?? 0), 0);
      return {
        ...stage,
        count: reached,
        percentage: total > 0 ? Math.round((reached / total) * 100) : 0,
      };
    }),
    rejected: outcomeMap.get('REJECTED') ?? 0,
    withdrawn: outcomeMap.get('WITHDRAWN') ?? 0,
    total,
  };
}

/* -------------------------------------------------------------------------- */
/* Platform-wide (super admin)                                                */
/* -------------------------------------------------------------------------- */

export async function platformOverview() {
  const [colleges, employers, users, events, certificates, subscriptions, recentAudit] = await Promise.all([
    Promise.all([
      prisma.college.count({ where: { deletedAt: null } }),
      prisma.college.count({ where: { deletedAt: null, isActive: true, isPilot: true } }),
    ]),
    Promise.all([
      prisma.employerProfile.count({ where: { deletedAt: null } }),
      prisma.employerProfile.count({ where: { deletedAt: null, isVerified: true } }),
    ]),
    prisma.user.groupBy({
      by: ['role'],
      where: { deletedAt: null },
      _count: { role: true },
    }),
    prisma.event.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { status: true },
    }),
    prisma.certificate.count({ where: { status: 'ISSUED', deletedAt: null } }),
    prisma.subscription.groupBy({
      by: ['plan'],
      where: { deletedAt: null },
      _count: { plan: true },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, role: true } },
        college: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    colleges: { total: colleges[0], pilot: colleges[1] },
    employers: { total: employers[0], verified: employers[1] },
    users: {
      total: users.reduce((sum, row) => sum + row._count.role, 0),
      byRole: users.map((row) => ({ role: row.role, count: row._count.role })),
    },
    events: {
      total: events.reduce((sum, row) => sum + row._count.status, 0),
      byStatus: events.map((row) => ({ status: row.status, count: row._count.status })),
    },
    certificatesIssued: certificates,
    subscriptions: subscriptions.map((row) => ({ plan: row.plan, count: row._count.plan })),
    recentActivity: recentAudit,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function startOfMonth(date: Date): Date {
  const start = new Date(date);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export { resolveRange, scopeFor, userScope, readinessBand };
