import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { buildPaginationMeta, normalisePagination } from '../../utils/pagination.js';
import { auditCreate, auditUpdate, type AuditContext } from '../../utils/audit.js';
import { recalculateReadiness } from '../passport/passport.service.js';
import { hasPremiumAccess } from '../../services/premium.service.js';

type ProjectFilters = { page?: number; pageSize?: number; search?: string; difficulty?: number; caseStudy?: boolean };
type Reviewer = { id: string; collegeId: string | null; isSuperAdmin: boolean };

export async function listProjects(filters: ProjectFilters, collegeId: string | null, userId: string) {
  const pagination = normalisePagination(filters);
  const premiumAccess = await hasPremiumAccess(userId);
  const scope: Prisma.ProjectWhereInput = {
    deletedAt: null,
    AND: [
      { OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
      ...(filters.difficulty ? [{ difficulty: filters.difficulty }] : []),
      ...(filters.caseStudy === undefined ? [] : [{ isCaseStudy: filters.caseStudy }]),
      ...(filters.search ? [{ OR: [
        { title: { contains: filters.search, mode: 'insensitive' as const } },
        { summary: { contains: filters.search, mode: 'insensitive' as const } },
        { brief: { contains: filters.search, mode: 'insensitive' as const } },
      ] }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma.project.findMany({
      where: scope,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ isPremium: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, title: true, summary: true, brief: true, requirements: true, techStack: true, skillIds: true, difficulty: true, estimatedHours: true, isPremium: true, isCaseStudy: true, thumbnailUrl: true, course: { select: { id: true, title: true } }, _count: { select: { submissions: true } } },
    }),
    prisma.project.count({ where: scope }),
  ]);
  return {
    items: items.map((project) => {
      const canAccess = !project.isPremium || premiumAccess;
      return {
        ...project,
        canAccess,
        brief: canAccess ? project.brief : '',
        requirements: canAccess ? project.requirements : [],
        techStack: canAccess ? project.techStack : [],
      };
    }),
    meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
  };
}

export async function getProject(projectId: string, userId: string, collegeId: string | null) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
    select: { id: true, title: true, summary: true, brief: true, requirements: true, techStack: true, skillIds: true, difficulty: true, estimatedHours: true, isPremium: true, isCaseStudy: true, thumbnailUrl: true, course: { select: { id: true, title: true } }, createdAt: true },
  });
  if (!project) throw new NotFoundError('Project');
  const premiumAccess = project.isPremium && await hasPremiumAccess(userId);
  const submission = await prisma.projectSubmission.findFirst({
    where: { projectId, userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true, repoUrl: true, liveUrl: true, fileUrl: true, thumbnailUrl: true, summary: true, submissionNote: true, score: true, submittedAt: true, isApproved: true, reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { totalScore: true, maxScore: true, feedback: true, strengths: true, improvements: true, decision: true, createdAt: true } } },
  });
  const canAccess = !project.isPremium || premiumAccess || Boolean(submission);
  return {
    ...project,
    canAccess,
    brief: canAccess ? project.brief : '',
    requirements: canAccess ? project.requirements : [],
    techStack: canAccess ? project.techStack : [],
    submission,
  };
}

export async function listMySubmissions(userId: string) {
  return prisma.projectSubmission.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, projectId: true, status: true, repoUrl: true, liveUrl: true, summary: true, score: true, submittedAt: true, isApproved: true, updatedAt: true, project: { select: { id: true, title: true, difficulty: true, estimatedHours: true } }, reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { totalScore: true, maxScore: true, feedback: true, strengths: true, improvements: true, decision: true } } },
  });
}

export async function createSubmission(projectId: string, userId: string, collegeId: string | null, input: {
  summary: string; submissionNote?: string; repoUrl?: string; liveUrl?: string; fileUrl?: string; thumbnailUrl?: string;
}, context: AuditContext) {
  const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null, OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] }, select: { id: true, isPremium: true } });
  if (!project) throw new NotFoundError('Project');
  if (project.isPremium && !(await hasPremiumAccess(userId))) {
    throw new ForbiddenError('This project is premium. Upgrade your plan to submit work.');
  }
  const submission = await prisma.projectSubmission.create({
    data: {
      projectId,
      userId,
      collegeId,
      summary: input.summary,
      submissionNote: input.submissionNote ?? null,
      repoUrl: input.repoUrl || null,
      liveUrl: input.liveUrl || null,
      fileUrl: input.fileUrl || null,
      thumbnailUrl: input.thumbnailUrl || null,
      status: 'DRAFT',
    },
    select: { id: true, projectId: true, status: true, summary: true, createdAt: true },
  });
  auditCreate(context, 'ProjectSubmission', submission.id, { projectId });
  return submission;
}

export async function submitSubmission(submissionId: string, userId: string, context: AuditContext) {
  const submission = await prisma.projectSubmission.findFirst({ where: { id: submissionId, userId, deletedAt: null }, select: { id: true, status: true, summary: true } });
  if (!submission) throw new NotFoundError('Project submission');
  if (!['DRAFT', 'NEEDS_REVISION'].includes(submission.status)) throw new ValidationError('This submission cannot be resubmitted in its current state');
  if (!submission.summary || submission.summary.trim().length < 20) throw new ValidationError('Add a project summary before submitting');
  const updated = await prisma.projectSubmission.update({ where: { id: submissionId }, data: { status: 'SUBMITTED', submittedAt: new Date(), isApproved: false }, select: { id: true, status: true, submittedAt: true } });
  auditUpdate(context, 'ProjectSubmission', submissionId, { status: submission.status }, { status: updated.status });
  return updated;
}

export async function updateSubmission(submissionId: string, userId: string, input: {
  summary: string; submissionNote?: string; repoUrl?: string; liveUrl?: string; fileUrl?: string; thumbnailUrl?: string;
}, context: AuditContext) {
  const existing = await prisma.projectSubmission.findFirst({
    where: { id: submissionId, userId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) throw new NotFoundError('Project submission');
  if (!['DRAFT', 'NEEDS_REVISION'].includes(existing.status)) throw new ValidationError('This submission can no longer be edited');
  const result = await prisma.projectSubmission.update({
    where: { id: submissionId },
    data: {
      summary: input.summary,
      submissionNote: input.submissionNote ?? null,
      repoUrl: input.repoUrl || null,
      liveUrl: input.liveUrl || null,
      fileUrl: input.fileUrl || null,
      thumbnailUrl: input.thumbnailUrl || null,
      status: 'DRAFT',
    },
    select: { id: true, status: true, summary: true, updatedAt: true },
  });
  auditUpdate(context, 'ProjectSubmission', submissionId, { status: existing.status }, { status: result.status }, { resubmissionEdited: existing.status === 'NEEDS_REVISION' });
  return result;
}

export async function listPendingReviews(reviewer: Reviewer) {
  return prisma.projectSubmission.findMany({
    where: {
      deletedAt: null,
      status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      ...(reviewer.isSuperAdmin ? {} : { collegeId: reviewer.collegeId }),
    },
    orderBy: { submittedAt: 'asc' },
    take: 100,
    select: { id: true, status: true, summary: true, submissionNote: true, repoUrl: true, liveUrl: true, fileUrl: true, submittedAt: true, user: { select: { id: true, fullName: true, username: true, collegeId: true } }, project: { select: { id: true, title: true, requirements: true, techStack: true, difficulty: true } } },
  });
}

export async function reviewSubmission(submissionId: string, reviewer: Reviewer, input: {
  rubric: { criterion: string; maxPoints: number; score: number; comment?: string }[];
  feedback: string; strengths: string[]; improvements: string[]; decision: 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED';
}, context: AuditContext) {
  const submission = await prisma.projectSubmission.findFirst({
    where: { id: submissionId, deletedAt: null },
    select: { id: true, userId: true, collegeId: true, status: true, projectId: true },
  });
  if (!submission) throw new NotFoundError('Project submission');
  if (!['SUBMITTED', 'UNDER_REVIEW'].includes(submission.status)) throw new ValidationError('Only submitted work can be reviewed');
  if (!reviewer.isSuperAdmin && submission.collegeId !== reviewer.collegeId) throw new ForbiddenError('You can only review submissions from your institution');

  const maxScore = input.rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
  const earnedScore = input.rubric.reduce((sum, criterion) => sum + Math.min(criterion.maxPoints, criterion.score), 0);
  if (maxScore <= 0) throw new ValidationError('The review rubric must have at least one scored criterion');
  const totalScore = Math.round((earnedScore / maxScore) * 100);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.review.create({
      data: {
        submissionId,
        reviewerId: reviewer.id,
        rubric: input.rubric as Prisma.InputJsonValue,
        totalScore,
        maxScore: 100,
        feedback: input.feedback,
        strengths: input.strengths,
        improvements: input.improvements,
        decision: input.decision,
      },
    });
    return tx.projectSubmission.update({
      where: { id: submissionId },
      data: {
        status: input.decision,
        isApproved: input.decision === 'APPROVED',
        approvedAt: input.decision === 'APPROVED' ? new Date() : null,
        score: totalScore,
      },
      select: { id: true, status: true, score: true, isApproved: true, approvedAt: true },
    });
  });
  auditUpdate(context, 'ProjectSubmission', submissionId, { status: submission.status }, { status: updated.status, score: updated.score });
  if (input.decision === 'APPROVED') await recalculateReadiness(submission.userId);
  return updated;
}
