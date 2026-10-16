import type { Prisma } from '@prisma/client';
import { roleHasPermission } from '@campusconnect/shared';
import { prisma, notDeleted } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  ForbiddenError,
  NotFoundError,
  assertSameCollege,
  assertFound,
} from '../../utils/errors.js';
import { normalisePagination, buildOrderBy, paginated } from '../../utils/pagination.js';
import { sanitizeText, sanitizeMultilineText } from '../../utils/sanitize.js';
import { generateUsername } from '../../utils/ids.js';
import { auditUpdate, writeAudit, type AuditContext } from '../../utils/audit.js';

/**
 * User and profile service.
 *
 * Owns everything about a person's identity and their student profile: the
 * fields that appear on the passport, privacy controls, and the derived
 * denormalised counters.
 *
 * Multi-tenancy is enforced here rather than only in the controller: every read
 * that can be scoped by college is scoped, so a caller with a valid session for
 * college A cannot enumerate college B's students by guessing a filter.
 */

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export type StudentProfileDto = {
  id: string;
  username: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: string;
  college: { id: string; name: string; slug: string; logoUrl: string | null } | null;
  department: { id: string; name: string; code: string } | null;
  profile: {
    rollNumber: string | null;
    degree: string | null;
    graduationYear: number | null;
    cgpa: number | null;
    headline: string | null;
    location: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
    portfolioUrl: string | null;
    careerInterests: string[];
    passportVisibility: string;
    consentToEmployerSearch: boolean;
    readinessScore: number;
    readinessBreakdown: { skills: number; projects: number; internship: number; interview: number };
    stats: {
      eventsAttended: number;
      certificatesEarned: number;
      projectsCompleted: number;
      internshipsCompleted: number;
    };
  } | null;
  createdAt: Date;
};

const PROFILE_SELECT = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  emailVerifiedAt: true,
  college: { select: { id: true, name: true, slug: true, logoUrl: true } },
  department: { select: { id: true, name: true, code: true } },
  studentProfile: {
    select: {
      rollNumber: true,
      degree: true,
      graduationYear: true,
      cgpa: true,
      headline: true,
      location: true,
      linkedinUrl: true,
      githubUrl: true,
      portfolioUrl: true,
      careerInterests: true,
      passportVisibility: true,
      readinessScore: true,
      readinessSkills: true,
      readinessProjects: true,
      readinessInternship: true,
      readinessInterview: true,
      eventsAttended: true,
      certificatesEarned: true,
      projectsCompleted: true,
      internshipsCompleted: true,
      college: { select: { id: true, name: true, slug: true, logoUrl: true } },
      department: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.UserSelect;

type RawUser = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

function toDto(user: RawUser, options: { includePrivate?: boolean } = {}): StudentProfileDto {
  const sp = user.studentProfile;

  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: options.includePrivate ? user.email : user.email,
    phone: options.includePrivate ? user.phone : user.phone,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    role: user.role,
    college: sp?.college ?? user.college,
    department: sp?.department ?? user.department,
    profile: sp
      ? {
          rollNumber: sp.rollNumber,
          degree: sp.degree,
          graduationYear: sp.graduationYear,
          cgpa: sp.cgpa ? Number(sp.cgpa) : null,
          headline: sp.headline,
          location: sp.location,
          linkedinUrl: sp.linkedinUrl,
          githubUrl: sp.githubUrl,
          portfolioUrl: sp.portfolioUrl,
          careerInterests: sp.careerInterests,
          passportVisibility: sp.passportVisibility,
          consentToEmployerSearch: false, // populated by the caller that needs it
          readinessScore: sp.readinessScore,
          readinessBreakdown: {
            skills: sp.readinessSkills,
            projects: sp.readinessProjects,
            internship: sp.readinessInternship,
            interview: sp.readinessInterview,
          },
          stats: {
            eventsAttended: sp.eventsAttended,
            certificatesEarned: sp.certificatesEarned,
            projectsCompleted: sp.projectsCompleted,
            internshipsCompleted: sp.internshipsCompleted,
          },
        }
      : null,
    createdAt: user.createdAt,
  };
}

export async function getById(id: string): Promise<StudentProfileDto> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: PROFILE_SELECT,
  });

  if (!user) throw new NotFoundError('User');
  return toDto(user, { includePrivate: true });
}

/** Looks up a user by the public username used in passport URLs. */
export async function getByUsername(username: string): Promise<StudentProfileDto> {
  const user = await prisma.user.findFirst({
    where: { username: username.toLowerCase(), deletedAt: null },
    select: PROFILE_SELECT,
  });

  if (!user) throw new NotFoundError('Profile');
  return toDto(user);
}

/* -------------------------------------------------------------------------- */
/* Updates                                                                    */
/* -------------------------------------------------------------------------- */

export type UpdateUserInput = {
  fullName?: string;
  phone?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
};

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  context: AuditContext,
): Promise<StudentProfileDto> {
  const before = assertFound(
    await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { fullName: true, phone: true, avatarUrl: true, bio: true },
    }),
    'User',
  );

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.fullName !== undefined ? { fullName: sanitizeText(input.fullName, 120) } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      ...(input.bio !== undefined
        ? { bio: input.bio === null ? null : sanitizeMultilineText(input.bio, 500) }
        : {}),
    },
    select: PROFILE_SELECT,
  });

  auditUpdate(context, 'User', userId, before, {
    fullName: user.fullName,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
  });

  return toDto(user, { includePrivate: true });
}

export type UpdateStudentProfileInput = {
  username?: string;
  rollNumber?: string | null;
  departmentId?: string | null;
  graduationYear?: number | null;
  cgpa?: number | null;
  headline?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  careerInterests?: string[];
  passportVisibility?: 'PUBLIC' | 'EMPLOYERS_ONLY' | 'PRIVATE';
  consentToEmployerSearch?: boolean;
};

export async function updateStudentProfile(
  userId: string,
  input: UpdateStudentProfileInput,
  context: AuditContext,
): Promise<StudentProfileDto> {
  const profile = assertFound(
    await prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true, collegeId: true, username: true },
    }),
    'Student profile',
  );

  // A department must belong to the student's own college. Without this check a
  // crafted request could attach a student to another tenant's department and
  // appear in that college's analytics.
  if (input.departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: input.departmentId, collegeId: profile.collegeId, deletedAt: null },
      select: { id: true },
    });
    if (!department) throw new ForbiddenError('That department does not belong to your college');
  }

  // Username changes affect the public passport URL. Checked for uniqueness and
  // written to the User row (where the unique constraint lives).
  let username = input.username;
  if (username !== undefined) {
    username = username.toLowerCase();
    const taken = await prisma.user.findFirst({
      where: { username, id: { not: userId }, deletedAt: null },
      select: { id: true },
    });
    if (taken) throw new ForbiddenError('That username is already taken');
  }

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        ...(username !== undefined ? { username } : {}),
        ...(input.consentToEmployerSearch !== undefined
          ? { consentToEmployerSearch: input.consentToEmployerSearch }
          : {}),
      },
      select: PROFILE_SELECT,
    }),
    prisma.studentProfile.update({
      where: { id: profile.id },
      data: {
        ...(input.rollNumber !== undefined ? { rollNumber: input.rollNumber } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.graduationYear !== undefined ? { graduationYear: input.graduationYear } : {}),
        ...(input.cgpa !== undefined ? { cgpa: input.cgpa } : {}),
        ...(input.headline !== undefined
          ? { headline: input.headline === null ? null : sanitizeText(input.headline, 140) }
          : {}),
        ...(input.location !== undefined
          ? { location: input.location === null ? null : sanitizeText(input.location, 120) }
          : {}),
        ...(input.linkedinUrl !== undefined ? { linkedinUrl: input.linkedinUrl } : {}),
        ...(input.githubUrl !== undefined ? { githubUrl: input.githubUrl } : {}),
        ...(input.portfolioUrl !== undefined ? { portfolioUrl: input.portfolioUrl } : {}),
        ...(input.careerInterests !== undefined
          ? { careerInterests: input.careerInterests.map((i) => sanitizeText(i, 60)) }
          : {}),
        ...(input.passportVisibility !== undefined
          ? { passportVisibility: input.passportVisibility }
          : {}),
      },
    }),
  ]);

  auditUpdate(context, 'StudentProfile', profile.id, null, null, {
    fields: Object.keys(input),
    visibilityChanged: input.passportVisibility,
  });

  return toDto(updatedUser, { includePrivate: true });
}

/**
 * Assigns a username on first profile load, for accounts created before the
 * passport existed or when the generated name collided.
 */
export async function ensureUsername(userId: string): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { username: true, fullName: true },
  });

  if (!user) throw new NotFoundError('User');
  if (user.username) return user.username;

  const username = await generateUsername(user.fullName, async (candidate) => {
    const count = await prisma.user.count({ where: { username: candidate } });
    return count > 0;
  });

  await prisma.user.update({ where: { id: userId }, data: { username } });
  return username;
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

export type UserListFilters = {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  role?: string;
  collegeId?: string;
  departmentId?: string;
  graduationYear?: number;
  isActive?: boolean;
};

/**
 * Lists users within the caller's tenant.
 *
 * `callerCollegeId` is required for every non-super-admin caller — passing null
 * means "all colleges" and is only ever done by a platform operator. This makes
 * cross-tenant leakage a deliberate act rather than a missing filter.
 */
export async function list(
  filters: UserListFilters,
  caller: { collegeId: string | null; isSuperAdmin: boolean },
) {
  const pagination = normalisePagination(filters);

  const collegeScope = caller.isSuperAdmin
    ? filters.collegeId
      ? { collegeId: filters.collegeId }
      : {}
    : { collegeId: caller.collegeId };

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...collegeScope,
    ...(filters.role ? { role: filters.role as never } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.isActive !== undefined
      ? { status: filters.isActive ? 'ACTIVE' : { not: 'ACTIVE' } }
      : {}),
    ...(filters.graduationYear
      ? { studentProfile: { graduationYear: filters.graduationYear } }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { fullName: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
            { username: { contains: filters.search, mode: 'insensitive' } },
            { studentProfile: { rollNumber: { contains: filters.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const orderBy = buildOrderBy(
    filters.sortBy,
    filters.sortOrder,
    ['fullName', 'email', 'createdAt', 'lastLoginAt'] as const,
    'createdAt',
  );

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        fullName: true,
        email: true,
        username: true,
        avatarUrl: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        college: { select: { id: true, name: true } },
        department: { select: { id: true, name: true, code: true } },
        studentProfile: {
          select: {
            graduationYear: true,
            rollNumber: true,
            readinessScore: true,
            eventsAttended: true,
            certificatesEarned: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/* -------------------------------------------------------------------------- */
/* Administrative actions                                                     */
/* -------------------------------------------------------------------------- */

export async function setStatus(
  targetUserId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED',
  caller: { id: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<void> {
  const target = assertFound(
    await prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, role: true, collegeId: true, status: true },
    }),
    'User',
  );

  if (target.id === caller.id) {
    throw new ForbiddenError('You cannot change your own account status');
  }

  // Tenant boundary: an admin acts only within their own college.
  if (!caller.isSuperAdmin) {
    assertSameCollege(target.collegeId, caller.collegeId);
    // A college admin cannot suspend a super admin or a peer institution's staff.
    if (target.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Platform administrators cannot be modified from a college account');
    }
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetUserId },
      // Suspending also bumps tokenVersion, so existing sessions die immediately
      // rather than remaining valid until the access token expires.
      data: {
        status,
        ...(status === 'ACTIVE' ? {} : { tokenVersion: { increment: 1 } }),
      },
    }),
    ...(status === 'ACTIVE'
      ? []
      : [
          prisma.session.updateMany({
            where: { userId: targetUserId, revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: `Account ${status.toLowerCase()}` },
          }),
        ]),
  ]);

  writeAudit(context, 'UPDATE', 'User', targetUserId, {
    previousStatus: target.status,
    newStatus: status,
  });

  logger.info('User status changed', {
    targetUserId,
    from: target.status,
    to: status,
    byUserId: caller.id,
  });
}

/** Soft-deletes a user and anonymises the fields that identify them. */
export async function softDelete(
  targetUserId: string,
  caller: { id: string; collegeId: string | null; isSuperAdmin: boolean },
  context: AuditContext,
): Promise<void> {
  const target = assertFound(
    await prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, email: true, role: true, collegeId: true },
    }),
    'User',
  );

  if (target.id === caller.id) throw new ForbiddenError('You cannot delete your own account');
  if (!caller.isSuperAdmin) {
    assertSameCollege(target.collegeId, caller.collegeId);
    if (target.role === 'SUPER_ADMIN' || target.role === 'COLLEGE_ADMIN') {
      throw new ForbiddenError('That account cannot be deleted from a college account');
    }
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetUserId },
      data: {
        deletedAt: now,
        status: 'DEACTIVATED',
        tokenVersion: { increment: 1 },
        // Anonymise the identifying fields while keeping the row, so foreign keys
        // from certificates and audit logs stay valid.
        email: `deleted-${targetUserId}@campusconnect.invalid`,
        username: null,
        fullName: 'Deleted user',
        phone: null,
        avatarUrl: null,
        bio: null,
        consentToEmployerSearch: false,
      },
    }),
    prisma.session.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'Account deleted' },
    }),
    prisma.studentProfile.updateMany({
      where: { userId: targetUserId },
      data: { passportVisibility: 'PRIVATE', consentToEmployerSearch: false, deletedAt: now },
    }),
  ]);

  writeAudit(context, 'DELETE', 'User', targetUserId, { previousEmail: target.email });
  logger.warn('User soft-deleted', { targetUserId, byUserId: caller.id });
}

/* -------------------------------------------------------------------------- */
/* Permission helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * True when the caller may see a student's full profile.
 *
 * Rules, in order: the student themselves always; a college administrator within
 * the same college; an employer only when the profile is employers-visible *and*
 * the student has consented to employer search.
 */
export function canViewProfile(
  viewer: { id: string; role: string; collegeId: string | null },
  target: { userId: string; collegeId: string; passportVisibility: string; consentToEmployerSearch: boolean },
): boolean {
  if (viewer.id === target.userId) return true;
  if (roleHasPermission(viewer.role as never, 'analytics:read_college')) {
    return viewer.collegeId === target.collegeId;
  }
  if (viewer.role === 'EMPLOYER' || viewer.role === 'SUPER_ADMIN') {
    if (viewer.role === 'SUPER_ADMIN') return true;
    return (
      target.consentToEmployerSearch &&
      (target.passportVisibility === 'EMPLOYERS_ONLY' || target.passportVisibility === 'PUBLIC')
    );
  }
  return false;
}

export { toDto as __toDto, notDeleted };
