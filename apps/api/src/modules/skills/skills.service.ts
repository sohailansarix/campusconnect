import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../../utils/errors.js';
import { buildPaginationMeta, normalisePagination } from '../../utils/pagination.js';
import { proficiencyForScore } from '../../services/ai/readiness.service.js';
import { recalculateReadiness } from '../passport/passport.service.js';
import { hasPremiumAccess } from '../../services/premium.service.js';

type AssessmentFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  kind?: 'SKILL' | 'INTEREST';
  categoryId?: string;
};

type AssessmentOption = { id: string; text: string; interestTracks?: string[] };

function readOptions(value: Prisma.JsonValue): AssessmentOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return [];
    if (typeof option.id !== 'string' || typeof option.text !== 'string') return [];
    const interestTracks = Array.isArray(option.interestTracks)
      ? option.interestTracks.filter((track): track is string => typeof track === 'string')
      : undefined;
    return [{ id: option.id, text: option.text, ...(interestTracks ? { interestTracks } : {}) }];
  });
}

function publicOptions(value: Prisma.JsonValue): { id: string; text: string }[] {
  return readOptions(value).map(({ id, text }) => ({ id, text }));
}

export async function listAssessments(filters: AssessmentFilters, collegeId: string | null) {
  const pagination = normalisePagination(filters);
  const scope: Prisma.AssessmentWhereInput = {
    isActive: true,
    deletedAt: null,
    AND: [
      { OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
      ...(filters.kind ? [{ kind: filters.kind }] : []),
      ...(filters.categoryId ? [{ categoryId: filters.categoryId }] : []),
      ...(filters.search
        ? [{ OR: [{ name: { contains: filters.search, mode: 'insensitive' as const } }, { description: { contains: filters.search, mode: 'insensitive' as const } }] }]
        : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma.assessment.findMany({
      where: scope,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        kind: true,
        durationMinutes: true,
        passScore: true,
        isPremium: true,
        categoryId: true,
        skillId: true,
        _count: { select: { questions: true } },
      },
    }),
    prisma.assessment.count({ where: scope }),
  ]);
  const categoryIds = [...new Set(items.map((item) => item.categoryId).filter((id): id is string => Boolean(id)))];
  const skillIds = [...new Set(items.map((item) => item.skillId).filter((id): id is string => Boolean(id)))];
  const [categories, skills] = await Promise.all([
    categoryIds.length ? prisma.skillCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, colorToken: true } }) : Promise.resolve([]),
    skillIds.length ? prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  return {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      description: item.description,
      kind: item.kind,
      durationMinutes: item.durationMinutes,
      passScore: item.passScore,
      isPremium: item.isPremium,
      category: item.categoryId ? categoryById.get(item.categoryId) ?? null : null,
      skill: item.skillId ? skillById.get(item.skillId) ?? null : null,
      _count: item._count,
    })),
    meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
  };
}

export async function getAssessment(assessmentId: string, collegeId: string | null, userId: string | null) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      id: assessmentId,
      isActive: true,
      deletedAt: null,
      OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      kind: true,
      durationMinutes: true,
      passScore: true,
      isPremium: true,
      skillId: true,
      categoryId: true,
      _count: { select: { questions: true } },
    },
  });
  if (!assessment) throw new NotFoundError('Assessment');
  const [category, skills] = await Promise.all([
    assessment.categoryId ? prisma.skillCategory.findUnique({ where: { id: assessment.categoryId }, select: { id: true, name: true, colorToken: true } }) : Promise.resolve(null),
    assessment.skillId ? prisma.skill.findMany({ where: { id: assessment.skillId }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const canAttempt = !assessment.isPremium || Boolean(userId && await hasPremiumAccess(userId));

  return {
    ...assessment,
    questionCount: assessment._count.questions,
    canAttempt,
    category,
    skill: assessment.skillId ? skillById.get(assessment.skillId) ?? null : null,
    // Timed questions are returned only after an attempt starts; otherwise the
    // detail page would disclose the exam before the countdown begins.
    questions: [],
  };
}

export async function startAttempt(assessmentId: string, userId: string, collegeId: string | null) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      id: assessmentId,
      isActive: true,
      deletedAt: null,
      OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])],
    },
    include: { questions: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!assessment) throw new NotFoundError('Assessment');
  if (assessment.questions.length === 0) throw new ValidationError('This assessment has no questions yet');
  if (assessment.isPremium && !(await hasPremiumAccess(userId))) {
    throw new ForbiddenError('This assessment is premium. Upgrade your plan to take it.');
  }

  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Student profile');

  const attempt = await prisma.assessmentAttempt.create({
    data: { assessmentId, userId, collegeId },
    select: { id: true, startedAt: true },
  });

  return {
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    durationMinutes: assessment.durationMinutes,
    assessment: { id: assessment.id, name: assessment.name, kind: assessment.kind, passScore: assessment.passScore },
    questions: assessment.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: publicOptions(question.options),
      points: question.points,
    })),
  };
}

export async function submitAttempt(
  assessmentId: string,
  attemptId: string,
  userId: string,
  answers: Record<string, string>,
) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, assessmentId, userId },
    include: {
      assessment: { include: { questions: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
  if (!attempt) throw new NotFoundError('Assessment attempt');
  if (attempt.submittedAt) throw new ConflictError('This assessment attempt has already been submitted');

  const elapsedMs = Date.now() - attempt.startedAt.getTime();
  const maxMs = attempt.assessment.durationMinutes * 60_000 + 30_000;
  if (elapsedMs > maxMs) throw new ValidationError('The assessment time limit has expired');

  const questionIds = new Set(attempt.assessment.questions.map((question) => question.id));
  if (Object.keys(answers).some((questionId) => !questionIds.has(questionId))) {
    throw new ValidationError('Answers include a question that does not belong to this assessment');
  }
  if (Object.keys(answers).length === 0) throw new ValidationError('Answer at least one question before submitting');

  const assessedSkillIds = [...new Set([attempt.assessment.skillId, ...attempt.assessment.questions.map((question) => question.skillId)].filter((id): id is string => Boolean(id)))];
  const assessedSkills = assessedSkillIds.length ? await prisma.skill.findMany({ where: { id: { in: assessedSkillIds } }, select: { id: true, name: true } }) : [];
  const skillNameById = new Map(assessedSkills.map((skill) => [skill.id, skill.name]));

  let earnedPoints = 0;
  let correctCount = 0;
  let maximumPoints = 0;
  const skills = new Map<string, { name: string; earned: number; total: number }>();
  const interestScores = new Map<string, number>();

  for (const question of attempt.assessment.questions) {
    const optionId = answers[question.id];
    const options = readOptions(question.options);
    const selected = options.find((option) => option.id === optionId);
    if (optionId && !selected) throw new ValidationError('An answer does not match one of the question options');

    if (attempt.assessment.kind === 'INTEREST') {
      for (const track of selected?.interestTracks ?? []) interestScores.set(track, (interestScores.get(track) ?? 0) + 1);
      continue;
    }

    maximumPoints += question.points;
    const correct = optionId === question.correctOptionId;
    if (correct) {
      earnedPoints += question.points;
      correctCount += 1;
    }
    const skillId = question.skillId ?? attempt.assessment.skillId;
    const skillName = skillId ? skillNameById.get(skillId) : undefined;
    if (skillId && skillName) {
      const aggregate = skills.get(skillId) ?? { name: skillName, earned: 0, total: 0 };
      aggregate.total += question.points;
      if (correct) aggregate.earned += question.points;
      skills.set(skillId, aggregate);
    }
  }

  const score = attempt.assessment.kind === 'INTEREST'
    ? null
    : maximumPoints > 0 ? Math.round((earnedPoints / maximumPoints) * 100) : 0;
  const breakdown = attempt.assessment.kind === 'INTEREST'
    ? Object.fromEntries([...interestScores].sort((a, b) => b[1] - a[1]))
    : Object.fromEntries([...skills].map(([skillId, value]) => [value.name, Math.round((value.earned / Math.max(1, value.total)) * 100)]));
  const interests = [...interestScores.entries()].sort((a, b) => b[1] - a[1]).map(([track]) => track);
  const submittedAt = new Date();
  const passed = score === null ? null : score >= attempt.assessment.passScore;

  const result = await prisma.$transaction(async (tx) => {
    const submitted = await tx.assessmentAttempt.updateMany({
      where: { id: attempt.id, userId, assessmentId, submittedAt: null },
      data: {
        answers,
        score,
        breakdown: breakdown as Prisma.InputJsonValue,
        passed,
        submittedAt,
        appliedToProfile: true,
      },
    });
    if (submitted.count !== 1) throw new ConflictError('This assessment attempt has already been submitted');
    const updatedAttempt = await tx.assessmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });

    if (attempt.assessment.kind === 'INTEREST') {
      await tx.studentProfile.update({
        where: { userId },
        data: { careerInterests: interests },
      });
    } else {
      const profile = await tx.studentProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!profile) throw new NotFoundError('Student profile');
      for (const [skillId, value] of skills) {
        const skillScore = Math.round((value.earned / Math.max(1, value.total)) * 100);
        await tx.studentSkill.upsert({
          where: { studentProfileId_skillId: { studentProfileId: profile.id, skillId } },
          create: {
            studentProfileId: profile.id,
            skillId,
            proficiency: proficiencyForScore(skillScore),
            score: skillScore,
            source: 'ASSESSMENT',
            isVerified: true,
            verifiedAt: submittedAt,
          },
          update: {
            proficiency: proficiencyForScore(skillScore),
            score: skillScore,
            source: 'ASSESSMENT',
            isVerified: true,
            verifiedAt: submittedAt,
          },
        });
      }
    }
    return updatedAttempt;
  });

  if (attempt.assessment.kind === 'SKILL') await recalculateReadiness(userId);

  return {
    id: result.id,
    assessmentId,
    kind: attempt.assessment.kind,
    score,
    passed: result.passed,
    breakdown,
    interests,
    submittedAt: result.submittedAt,
    correctCount,
    questionCount: attempt.assessment.questions.length,
    explanations: attempt.assessment.kind === 'SKILL'
      ? attempt.assessment.questions.map((question) => ({
          questionId: question.id,
          correctOptionId: question.correctOptionId,
          selectedOptionId: answers[question.id] ?? null,
          explanation: question.explanation,
        }))
      : [],
  };
}

export async function listMyAttempts(userId: string) {
  return prisma.assessmentAttempt.findMany({
    where: { userId, submittedAt: { not: null } },
    orderBy: { submittedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      score: true,
      passed: true,
      breakdown: true,
      startedAt: true,
      submittedAt: true,
      assessment: { select: { id: true, name: true, slug: true, kind: true, durationMinutes: true } },
    },
  });
}

export async function listMySkills(userId: string) {
  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Student profile');
  return prisma.studentSkill.findMany({
    where: { studentProfileId: profile.id, deletedAt: null },
    orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      score: true,
      proficiency: true,
      source: true,
      isVerified: true,
      verifiedAt: true,
      skill: { select: { id: true, name: true, category: { select: { id: true, name: true, colorToken: true } } } },
    },
  });
}
