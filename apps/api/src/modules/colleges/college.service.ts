import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFoundError, ForbiddenError, ConflictError, assertFound } from '../../utils/errors.js';
import { normalisePagination, paginated, buildOrderBy } from '../../utils/pagination.js';
import { sanitizeText } from '../../utils/sanitize.js';
import { uniqueSlug } from '../../utils/ids.js';
import { auditCreate, auditUpdate, type AuditContext } from '../../utils/audit.js';

/**
 * College and department service.
 *
 * A college is the tenant boundary for everything else, so this module is
 * deliberately conservative: creating a college is a platform-operator action,
 * and every write is scoped to one college.
 */

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Public list used by the signup form. Exposes only non-sensitive fields. */
export async function listPublic(options: { search?: string } = {}) {
  return prisma.college.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: 'insensitive' } },
              { city: { contains: options.search, mode: 'insensitive' } },
              { shortName: { contains: options.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      shortName: true,
      slug: true,
      city: true,
      state: true,
      logoUrl: true,
      // Included so the signup form can show the department picker without a
      // second round trip. Departments are not sensitive.
      departments: {
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, degree: true },
      },
    },
    take: 200,
  });
}

export async function getById(
  collegeId: string,
  options: { includeCounts?: boolean } = {},
) {
  const college = await prisma.college.findFirst({
    where: { id: collegeId, deletedAt: null },
    select: {
      id: true,
      name: true,
      shortName: true,
      slug: true,
      city: true,
      state: true,
      country: true,
      website: true,
      logoUrl: true,
      bannerUrl: true,
      placementEmail: true,
      placementPhone: true,
      isActive: true,
      isPilot: true,
      studentCount: true,
      eventsHosted: true,
      createdAt: true,
      departments: {
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, degree: true, isActive: true },
      },
      ...(options.includeCounts
        ? {
            _count: {
              select: { users: true, events: true, clubs: true, certificates: true },
            },
          }
        : {}),
    },
  });

  if (!college) throw new NotFoundError('College');
  return college;
}

export async function getBySlug(slug: string) {
  const college = await prisma.college.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, name: true, slug: true, logoUrl: true, city: true, state: true },
  });

  if (!college) throw new NotFoundError('College');
  return college;
}

/* -------------------------------------------------------------------------- */
/* Platform-operator writes                                                   */
/* -------------------------------------------------------------------------- */

export type CreateCollegeInput = {
  name: string;
  shortName?: string;
  city?: string;
  state?: string;
  website?: string;
  placementEmail?: string;
  placementPhone?: string;
  isPilot?: boolean;
  /** Departments to create alongside the college — avoids a broken signup form. */
  departments?: { name: string; code: string; degree?: string; durationYears?: number }[];
};

export async function createCollege(
  input: CreateCollegeInput,
  context: AuditContext,
): Promise<{ id: string; slug: string }> {
  const slug = await uniqueSlug(input.name, async (candidate) => {
    const count = await prisma.college.count({ where: { slug: candidate } });
    return count > 0;
  });

  const college = await prisma.$transaction(async (tx) => {
    const created = await tx.college.create({
      data: {
        name: sanitizeText(input.name, 160),
        shortName: input.shortName ? sanitizeText(input.shortName, 40) : null,
        slug,
        city: input.city ? sanitizeText(input.city, 80) : null,
        state: input.state ? sanitizeText(input.state, 80) : null,
        website: input.website ?? null,
        placementEmail: input.placementEmail ?? null,
        placementPhone: input.placementPhone ?? null,
        isPilot: input.isPilot ?? false,
        isActive: true,
      },
      select: { id: true, slug: true },
    });

    if (input.departments && input.departments.length > 0) {
      await tx.department.createMany({
        data: input.departments.map((department) => ({
          collegeId: created.id,
          name: sanitizeText(department.name, 120),
          code: department.code.toUpperCase(),
          degree: department.degree ?? null,
          durationYears: department.durationYears ?? 4,
        })),
        // A duplicate code is a data-entry mistake worth surfacing rather than
        // silently skipping.
        skipDuplicates: false,
      });
    }

    return created;
  });

  auditCreate(context, 'College', college.id, { name: input.name, slug: college.slug });

  return college;
}

export type UpdateCollegeInput = {
  name?: string;
  city?: string | null;
  state?: string | null;
  logoUrl?: string | null;
  website?: string | null;
  placementEmail?: string | null;
  isActive?: boolean;
  isPilot?: boolean;
};

export async function updateCollege(
  collegeId: string,
  input: UpdateCollegeInput,
  context: AuditContext,
): Promise<void> {
  const before = assertFound(
    await prisma.college.findFirst({
      where: { id: collegeId, deletedAt: null },
      select: {
        name: true,
        city: true,
        state: true,
        logoUrl: true,
        website: true,
        placementEmail: true,
        isActive: true,
        isPilot: true,
      },
    }),
    'College',
  );

  const after = await prisma.college.update({
    where: { id: collegeId },
    data: {
      ...(input.name !== undefined ? { name: sanitizeText(input.name, 160) } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.placementEmail !== undefined ? { placementEmail: input.placementEmail } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.isPilot !== undefined ? { isPilot: input.isPilot } : {}),
    },
    select: {
      name: true,
      city: true,
      state: true,
      logoUrl: true,
      website: true,
      placementEmail: true,
      isActive: true,
      isPilot: true,
    },
  });

  auditUpdate(context, 'College', collegeId, before, after);
}

/* -------------------------------------------------------------------------- */
/* Departments                                                                */
/* -------------------------------------------------------------------------- */

export async function createDepartment(
  collegeId: string,
  input: { name: string; code: string; degree?: string; durationYears?: number },
  context: AuditContext,
) {
  const code = input.code.toUpperCase();

  const existing = await prisma.department.findFirst({
    where: { collegeId, code, deletedAt: null },
    select: { id: true },
  });
  if (existing) throw new ConflictError(`A department with the code ${code} already exists`);

  const department = await prisma.department.create({
    data: {
      collegeId,
      name: sanitizeText(input.name, 120),
      code,
      degree: input.degree ?? null,
      durationYears: input.durationYears ?? 4,
    },
    select: { id: true, name: true, code: true },
  });

  auditCreate(context, 'Department', department.id, { collegeId, code });

  return department;
}

export async function updateDepartment(
  departmentId: string,
  collegeId: string,
  input: { name?: string; code?: string; degree?: string | null; isActive?: boolean },
  context: AuditContext,
) {
  const before = assertFound(
    await prisma.department.findFirst({
      where: { id: departmentId, collegeId, deletedAt: null },
      select: { name: true, code: true, degree: true, isActive: true },
    }),
    'Department',
  );

  const after = await prisma.department.update({
    where: { id: departmentId },
    data: {
      ...(input.name !== undefined ? { name: sanitizeText(input.name, 120) } : {}),
      ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
      ...(input.degree !== undefined ? { degree: input.degree } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: { name: true, code: true, degree: true, isActive: true },
  });

  auditUpdate(context, 'Department', departmentId, before, after);

  return after;
}

/**
 * Deactivates a department. Refuses when students are still attached, because
 * silently orphaning them would remove people from every department-scoped
 * report.
 */
export async function deactivateDepartment(
  departmentId: string,
  collegeId: string,
  context: AuditContext,
): Promise<{ movedStudents: number }> {
  const department = assertFound(
    await prisma.department.findFirst({
      where: { id: departmentId, collegeId, deletedAt: null },
      select: { id: true, code: true },
    }),
    'Department',
  );

  const studentCount = await prisma.user.count({
    where: { departmentId: department.id, deletedAt: null, role: 'STUDENT' },
  });

  if (studentCount > 0) {
    throw new ConflictError(
      `${studentCount} student${studentCount === 1 ? ' is' : 's are'} still assigned to ${department.code}. Move them first.`,
    );
  }

  await prisma.department.update({
    where: { id: department.id },
    data: { isActive: false, deletedAt: new Date() },
  });

  auditUpdate(context, 'Department', department.id, { isActive: true }, { isActive: false });

  return { movedStudents: 0 };
}

/* -------------------------------------------------------------------------- */
/* Analytics helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Refreshes the denormalised counters on the college row. */
export async function refreshCounters(collegeId: string): Promise<void> {
  const [studentCount, eventsHosted] = await Promise.all([
    prisma.user.count({ where: { collegeId, role: 'STUDENT', deletedAt: null, status: 'ACTIVE' } }),
    prisma.event.count({ where: { collegeId, status: 'COMPLETED', deletedAt: null } }),
  ]);

  await prisma.college.update({
    where: { id: collegeId },
    data: { studentCount, eventsHosted },
  });
}

/** All colleges, for the super-admin dashboard. */
export async function listAllForAdmin(filters: {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}) {
  const pagination = normalisePagination(filters);

  const where: Prisma.CollegeWhereInput = {
    deletedAt: null,
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { city: { contains: filters.search, mode: 'insensitive' } },
            { slug: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.college.findMany({
      where,
      orderBy: buildOrderBy(undefined, undefined, ['name', 'createdAt'] as const, 'createdAt'),
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        state: true,
        logoUrl: true,
        isActive: true,
        isPilot: true,
        studentCount: true,
        eventsHosted: true,
        createdAt: true,
        _count: { select: { users: true, events: true, clubs: true, certificates: true } },
      },
    }),
    prisma.college.count({ where }),
  ]);

  return paginated(items, total, pagination);
}

/** Guards a college-scoped action for a caller from a different tenant. */
export function assertCollegeAccess(
  caller: { collegeId: string | null; isSuperAdmin: boolean },
  targetCollegeId: string,
): void {
  if (caller.isSuperAdmin) return;
  if (caller.collegeId !== targetCollegeId) {
    throw new ForbiddenError('You can only manage your own institution');
  }
}
