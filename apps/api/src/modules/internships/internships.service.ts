import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ForbiddenError, NotFoundError, ConflictError } from '../../utils/errors.js';
import { buildPaginationMeta, normalisePagination } from '../../utils/pagination.js';
import { auditCreate, type AuditContext } from '../../utils/audit.js';
import { buildPassport } from '../passport/passport.service.js';
import { ensureUsername } from '../users/user.service.js';
import { hasPremiumAccess } from '../../services/premium.service.js';

type InternshipFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  workMode?: 'REMOTE' | 'ONSITE' | 'HYBRID';
  opportunityKind?: 'INTERNSHIP' | 'INDUSTRY_PROJECT' | 'APPRENTICESHIP';
  location?: string;
  premium?: boolean;
};

export async function listInternships(filters: InternshipFilters, collegeId: string | null) {
  const pagination = normalisePagination(filters);
  const where: Prisma.InternshipWhereInput = {
    isPublished: true,
    deletedAt: null,
    closedAt: null,
    AND: [
      { OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
      ...(filters.workMode ? [{ workMode: filters.workMode }] : []),
      ...(filters.opportunityKind ? [{ opportunityKind: filters.opportunityKind }] : []),
      ...(filters.premium === undefined ? [] : [{ isPremium: filters.premium }]),
      ...(filters.location ? [{ location: { contains: filters.location, mode: 'insensitive' as const } }] : []),
      ...(filters.search ? [{ OR: [
        { title: { contains: filters.search, mode: 'insensitive' as const } },
        { companyName: { contains: filters.search, mode: 'insensitive' as const } },
        { role: { contains: filters.search, mode: 'insensitive' as const } },
      ] }] : []),
      { OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }] },
    ],
  };
  const [items, total] = await Promise.all([
    prisma.internship.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ isPremium: 'asc' }, { publishedAt: 'desc' }],
      select: {
        id: true, title: true, slug: true, description: true, companyName: true, companyLogoUrl: true,
        role: true, department: true, workMode: true, location: true, durationMonths: true,
        stipendMonthly: true, currency: true, skillIds: true, minReadinessScore: true,
        eligibleGraduationYears: true, openings: true, isPremium: true, opportunityKind: true,
        applicationDeadline: true, startDate: true, isCurated: true, publishedAt: true,
        employer: { select: { companyName: true, isVerified: true, logoUrl: true } },
      },
    }),
    prisma.internship.count({ where }),
  ]);
  return { items, meta: buildPaginationMeta(pagination.page, pagination.pageSize, total) };
}

export async function getInternship(slugOrId: string, collegeId: string | null) {
  const internship = await prisma.internship.findFirst({
    where: {
      OR: [{ id: slugOrId }, { slug: slugOrId }],
      isPublished: true,
      deletedAt: null,
      closedAt: null,
      AND: [
        { OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
        { OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }] },
      ],
    },
    select: {
      id: true, title: true, slug: true, description: true, companyName: true, companyLogoUrl: true,
      role: true, department: true, workMode: true, location: true, durationMonths: true,
      stipendMonthly: true, currency: true, skillIds: true, minReadinessScore: true,
      eligibleGraduationYears: true, openings: true, isPremium: true, opportunityKind: true,
      applicationDeadline: true, startDate: true, isCurated: true, publishedAt: true,
      employer: { select: { companyName: true, isVerified: true, logoUrl: true, about: true } },
    },
  });
  if (!internship) throw new NotFoundError('Internship');
  return internship;
}

export async function applyForInternship(
  internshipId: string,
  user: { id: string; collegeId: string | null; role: string },
  input: { coverNote?: string; resumeId?: string; consentToShare: true },
  context: AuditContext,
) {
  if (!user.collegeId || user.role !== 'STUDENT') throw new ForbiddenError('Only students at a college can apply to internships');
  const internship = await prisma.internship.findFirst({
    where: {
      id: internshipId,
      isPublished: true,
      deletedAt: null,
      closedAt: null,
      AND: [
        { OR: [{ collegeId: null }, { collegeId: user.collegeId }] },
        { OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }] },
      ],
    },
    select: { id: true, title: true, isPremium: true, minReadinessScore: true, eligibleGraduationYears: true },
  });
  if (!internship) throw new NotFoundError('Internship');

  const [student, existing, resume] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { username: true, studentProfile: { select: { graduationYear: true, readinessScore: true } } } }),
    prisma.application.findUnique({ where: { userId_internshipId: { userId: user.id, internshipId } }, select: { id: true } }),
    input.resumeId ? prisma.resume.findFirst({ where: { id: input.resumeId, userId: user.id, deletedAt: null }, select: { id: true, pdfUrl: true } }) : Promise.resolve(null),
  ]);
  const profile = student?.studentProfile;
  if (existing) throw new ConflictError('You have already applied to this opportunity');
  if (input.resumeId && !resume) throw new NotFoundError('Resume');
  if (internship.isPremium && !(await hasPremiumAccess(user.id))) {
    throw new ForbiddenError('This is a premium opportunity. Upgrade your plan to apply.');
  }
  if (internship.minReadinessScore && (profile?.readinessScore ?? 0) < internship.minReadinessScore) {
    throw new ForbiddenError(`This opportunity requires a readiness score of ${internship.minReadinessScore} or higher`);
  }
  if (internship.eligibleGraduationYears.length > 0 && profile?.graduationYear && !internship.eligibleGraduationYears.includes(profile.graduationYear)) {
    throw new ForbiddenError('Your graduation year is not eligible for this opportunity');
  }

  const username = student?.username || await ensureUsername(user.id);
  const snapshot = await buildPassport(username, {
    viewer: { id: user.id, role: user.role, collegeId: user.collegeId },
    recordView: false,
  });
  const application = await prisma.application.create({
    data: {
      userId: user.id,
      collegeId: user.collegeId,
      internshipId,
      status: 'APPLIED',
      passportSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      resumeUrl: resume?.pdfUrl ?? null,
      coverNote: input.coverNote ?? null,
      consentToShare: input.consentToShare,
      source: 'DIRECT',
      appliedAt: new Date(),
    },
    select: { id: true, status: true, appliedAt: true, internship: { select: { title: true, companyName: true } } },
  });
  auditCreate(context, 'Application', application.id, { internshipId, consentToShare: true });
  return application;
}

export async function listMyApplications(userId: string) {
  return prisma.application.findMany({
    where: { userId, internshipId: { not: null }, deletedAt: null },
    orderBy: { appliedAt: 'desc' },
    select: {
      id: true, status: true, appliedAt: true, reviewedAt: true, rejectReason: true,
      internship: { select: { id: true, title: true, slug: true, companyName: true, companyLogoUrl: true, workMode: true, location: true, startDate: true, applicationDeadline: true } },
    },
  });
}
