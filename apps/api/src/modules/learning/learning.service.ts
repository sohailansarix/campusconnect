import type { Prisma } from '@prisma/client';
import { ai, type LearningPathInput } from '../../services/ai/index.js';
import { prisma } from '../../config/prisma.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { normalisePagination, buildPaginationMeta } from '../../utils/pagination.js';
import { generateCertificateId } from '../../utils/ids.js';
import { recalculateReadiness } from '../passport/passport.service.js';
import { proficiencyForScore } from '../../services/ai/readiness.service.js';
import { hasPremiumAccess } from '../../services/premium.service.js';

const CAREER_TRACKS = [
  {
    id: 'business-analyst',
    title: 'Business Analyst',
    description: 'Turn business questions into clear analysis, dashboards and recommendations.',
    skills: [
      { name: 'Advanced Excel', expectedLevel: 'ADVANCED', weight: 1 },
      { name: 'SQL', expectedLevel: 'INTERMEDIATE', weight: 0.9 },
      { name: 'Power BI', expectedLevel: 'INTERMEDIATE', weight: 0.8 },
      { name: 'Communication', expectedLevel: 'INTERMEDIATE', weight: 0.7 },
    ],
  },
  {
    id: 'data-analyst',
    title: 'Data Analyst',
    description: 'Build reliable analysis with spreadsheets, SQL, statistics and visualisation.',
    skills: [
      { name: 'SQL', expectedLevel: 'ADVANCED', weight: 1 },
      { name: 'Advanced Excel', expectedLevel: 'INTERMEDIATE', weight: 0.8 },
      { name: 'Power BI', expectedLevel: 'INTERMEDIATE', weight: 0.9 },
      { name: 'Statistics', expectedLevel: 'INTERMEDIATE', weight: 0.8 },
      { name: 'Python', expectedLevel: 'BEGINNER', weight: 0.6 },
    ],
  },
  {
    id: 'digital-marketer',
    title: 'Digital Marketer',
    description: 'Plan campaigns, grow audiences and measure the results of your work.',
    skills: [
      { name: 'Digital Marketing', expectedLevel: 'ADVANCED', weight: 1 },
      { name: 'SEO', expectedLevel: 'INTERMEDIATE', weight: 0.8 },
      { name: 'Social Media Marketing', expectedLevel: 'INTERMEDIATE', weight: 0.8 },
      { name: 'Content Writing', expectedLevel: 'INTERMEDIATE', weight: 0.7 },
      { name: 'Google Analytics', expectedLevel: 'BEGINNER', weight: 0.6 },
    ],
  },
  {
    id: 'frontend-developer',
    title: 'Frontend Developer',
    description: 'Build accessible, responsive web interfaces and ship them to production.',
    skills: [
      { name: 'HTML', expectedLevel: 'INTERMEDIATE', weight: 0.8 },
      { name: 'CSS', expectedLevel: 'INTERMEDIATE', weight: 0.8 },
      { name: 'JavaScript', expectedLevel: 'ADVANCED', weight: 1 },
      { name: 'React', expectedLevel: 'INTERMEDIATE', weight: 0.9 },
      { name: 'Git', expectedLevel: 'BEGINNER', weight: 0.6 },
    ],
  },
] as const;

type CourseFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  premium?: boolean;
};

function readQuiz(value: Prisma.JsonValue | null): {
  passScore: number;
  questions: { id: string; prompt: string; options: { id: string; text: string }[]; correctOptionId: string; explanation?: string }[];
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Prisma.JsonObject;
  if (!Array.isArray(raw.questions)) return null;
  const questions = raw.questions.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const question = entry as Prisma.JsonObject;
    if (typeof question.id !== 'string' || typeof question.prompt !== 'string' || typeof question.correctOptionId !== 'string' || !Array.isArray(question.options)) return [];
    const options = question.options.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const option = item as Prisma.JsonObject;
      return typeof option.id === 'string' && typeof option.text === 'string' ? [{ id: option.id, text: option.text }] : [];
    });
    return [{
      id: question.id,
      prompt: question.prompt,
      options,
      correctOptionId: question.correctOptionId,
      ...(typeof question.explanation === 'string' ? { explanation: question.explanation } : {}),
    }];
  });
  return { passScore: typeof raw.passScore === 'number' ? raw.passScore : 70, questions };
}

export function listCareerTracks() {
  return CAREER_TRACKS;
}

async function buildRoadmap(userId: string, collegeId: string | null, trackId: string, weeklyHoursAvailable: number) {
  const track = CAREER_TRACKS.find((item) => item.id === trackId);
  if (!track) throw new ValidationError('Choose one of the supported career tracks');

  const profile = await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw new NotFoundError('Student profile');

  const [studentSkills, courses, projects, skillRecords] = await Promise.all([
    prisma.studentSkill.findMany({
      where: { studentProfileId: profile.id, deletedAt: null },
      select: { score: true, skill: { select: { name: true } } },
    }),
    prisma.course.findMany({
      where: { isPublished: true, deletedAt: null, OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
      select: { id: true, title: true, skillIds: true, durationMinutes: true, isPremium: true, level: true },
      take: 100,
    }),
    prisma.project.findMany({
      where: { deletedAt: null, OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
      select: { id: true, title: true, skillIds: true, difficulty: true },
      take: 100,
    }),
    prisma.skill.findMany({ select: { id: true, name: true } }),
  ]);

  const skillNameById = new Map(skillRecords.map((skill) => [skill.id, skill.name]));
  const input: LearningPathInput = {
    targetRole: track.title,
    currentSkills: studentSkills.map((skill) => ({ name: skill.skill.name, score: skill.score })),
    requiredSkills: track.skills.map((skill) => ({ ...skill })),
    availableCourses: courses.map((course) => ({
      id: course.id,
      title: course.title,
      skillNames: course.skillIds.map((id) => skillNameById.get(id)).filter((name): name is string => Boolean(name)),
      durationMinutes: course.durationMinutes,
      isPremium: course.isPremium,
      level: course.level,
    })),
    availableProjects: projects.map((project) => ({ id: project.id, title: project.title, skillIds: project.skillIds, difficulty: project.difficulty })),
    weeklyHoursAvailable,
  };
  const generated = await ai.learningPath(input);

  const roadmapId = await prisma.$transaction(async (tx) => {
    await tx.roadmap.updateMany({ where: { userId, isActive: true, deletedAt: null }, data: { isActive: false } });
    const roadmap = await tx.roadmap.create({
      data: {
        userId,
        track: track.title,
        title: `Your path to ${track.title}`,
        summary: `${generated.steps.length} steps · ${generated.totalEstimatedHours} hours · about ${generated.estimatedWeeks} weeks at ${weeklyHoursAvailable} hours per week.`,
        generatedBy: generated.generatedBy,
        gapSnapshot: {
          targetRole: track.title,
          requiredSkills: track.skills,
          currentSkills: input.currentSkills,
          generatedAt: new Date().toISOString(),
        },
        isActive: true,
        steps: {
          create: generated.steps.map((step) => ({
            title: step.title,
            description: `${step.description}\n\n${step.rationale}`,
            actionType: step.actionType,
            targetId: step.targetId,
            order: step.order,
            estimatedHours: step.estimatedHours,
          })),
        },
      },
      select: { id: true, steps: { select: { id: true } } },
    });
    if (roadmap.steps.length > 0) {
      await tx.roadmapStepProgress.createMany({
        data: roadmap.steps.map((step) => ({ roadmapStepId: step.id, userId })),
      });
    }
    return roadmap.id;
  });

  return getRoadmap(userId, roadmapId);
}

export async function getRoadmap(userId: string, roadmapId?: string) {
  return prisma.roadmap.findFirst({
    where: { userId, deletedAt: null, ...(roadmapId ? { id: roadmapId } : { isActive: true }) },
    orderBy: { createdAt: 'desc' },
    include: {
      steps: {
        orderBy: { order: 'asc' },
        include: { progress: { where: { userId }, select: { id: true, status: true, progressPct: true, completedAt: true } } },
      },
    },
  });
}

export async function updateRoadmapProgress(
  userId: string,
  roadmapId: string,
  stepId: string,
  input: { status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'; progressPct: number },
) {
  const step = await prisma.roadmapStep.findFirst({ where: { id: stepId, roadmapId, roadmap: { userId, deletedAt: null } }, select: { id: true } });
  if (!step) throw new NotFoundError('Roadmap step');
  const progressPct = input.status === 'COMPLETED' ? 100 : input.status === 'NOT_STARTED' ? 0 : Math.min(99, input.progressPct);
  return prisma.roadmapStepProgress.upsert({
    where: { roadmapStepId_userId: { roadmapStepId: stepId, userId } },
    create: { roadmapStepId: stepId, userId, status: input.status, progressPct, completedAt: input.status === 'COMPLETED' ? new Date() : null },
    update: { status: input.status, progressPct, completedAt: input.status === 'COMPLETED' ? new Date() : null },
  });
}

export async function listCourses(filters: CourseFilters, userId: string | null, collegeId: string | null) {
  const pagination = normalisePagination(filters);
  const where: Prisma.CourseWhereInput = {
    isPublished: true,
    deletedAt: null,
    AND: [
      { OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
      ...(filters.level ? [{ level: filters.level }] : []),
      ...(filters.category ? [{ category: { equals: filters.category, mode: 'insensitive' as const } }] : []),
      ...(filters.premium === undefined ? [] : [{ isPremium: filters.premium }]),
      ...(filters.search ? [{ OR: [{ title: { contains: filters.search, mode: 'insensitive' as const } }, { summary: { contains: filters.search, mode: 'insensitive' as const } }] }] : []),
    ],
  };
  const [items, total, enrollments] = await Promise.all([
    prisma.course.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ isPremium: 'asc' }, { title: 'asc' }],
      select: { id: true, title: true, slug: true, summary: true, thumbnailUrl: true, level: true, category: true, language: true, durationMinutes: true, isPremium: true, price: true, currency: true, enrollCount: true, completionCount: true, averageRating: true, skillIds: true, _count: { select: { modules: true, enrollments: true } } },
    }),
    prisma.course.count({ where }),
    userId ? prisma.enrollment.findMany({ where: { userId }, select: { courseId: true, status: true, progressPct: true } }) : Promise.resolve([]),
  ]);
  const enrollmentByCourse = new Map(enrollments.map((item) => [item.courseId, item]));
  return {
    items: items.map((course) => ({ ...course, enrolled: enrollmentByCourse.has(course.id), enrollment: enrollmentByCourse.get(course.id) ?? null })),
    meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
  };
}

export async function getCourse(slugOrId: string, userId: string | null, collegeId: string | null) {
  const course = await prisma.course.findFirst({
    where: {
      OR: [{ id: slugOrId }, { slug: slugOrId }],
      isPublished: true,
      deletedAt: null,
      AND: [{ OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] }],
    },
    include: {
      modules: { orderBy: { order: 'asc' }, include: { lessons: { orderBy: { order: 'asc' } } } },
    },
  });
  if (!course) throw new NotFoundError('Course');
  const enrollment = userId ? await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId: course.id, userId } } }) : null;
  const premiumAccess = Boolean(userId && course.isPremium && await hasPremiumAccess(userId));
  const canAccess = Boolean(enrollment || premiumAccess);
  const modules = course.modules.map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    order: module.order,
    requiresQuiz: module.requiresQuiz,
    lessons: module.lessons.map((lesson) => {
      const visible = canAccess || lesson.isPreview;
      return {
        id: lesson.id,
        title: lesson.title,
        contentType: lesson.contentType,
        durationMinutes: lesson.durationMinutes,
        order: lesson.order,
        isPreview: lesson.isPreview,
        locked: !visible,
        content: visible ? lesson.content : null,
        videoUrl: visible ? lesson.videoUrl : null,
        quiz: visible && canAccess ? sanitizeQuizForStudent(readQuiz(lesson.quiz)) : null,
      };
    }),
  }));
  return {
    id: course.id,
    title: course.title,
    slug: course.slug,
    summary: course.summary,
    description: course.description,
    thumbnailUrl: course.thumbnailUrl,
    level: course.level,
    category: course.category,
    language: course.language,
    durationMinutes: course.durationMinutes,
    isPremium: course.isPremium,
    price: course.price,
    currency: course.currency,
    skillIds: course.skillIds,
    modules,
    enrollment: enrollment ? { id: enrollment.id, status: enrollment.status, progressPct: enrollment.progressPct, completedLessonIds: enrollment.completedLessonIds, completedAt: enrollment.completedAt } : null,
    canAccess,
  };
}

function sanitizeQuizForStudent(quiz: ReturnType<typeof readQuiz>) {
  if (!quiz) return null;
  return { passScore: quiz.passScore, questions: quiz.questions.map(({ id, prompt, options }) => ({ id, prompt, options })) };
}

export async function enrollCourse(courseId: string, userId: string, collegeId: string | null) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, isPublished: true, deletedAt: null, OR: [{ collegeId: null }, ...(collegeId ? [{ collegeId }] : [])] },
    select: { id: true, isPremium: true },
  });
  if (!course) throw new NotFoundError('Course');
  if (course.isPremium && !(await hasPremiumAccess(userId))) throw new ForbiddenError('This course is premium. Upgrade your plan to enroll.');

  const existing = await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId, userId } } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.enrollment.create({ data: { courseId, userId, collegeId, status: 'ENROLLED' } });
    await tx.course.update({ where: { id: courseId }, data: { enrollCount: { increment: 1 } } });
    return enrollment;
  });
}

export async function myEnrollments(userId: string) {
  return prisma.enrollment.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { course: { select: { id: true, title: true, slug: true, thumbnailUrl: true, level: true, category: true, durationMinutes: true, isPremium: true } } },
  });
}

async function completeLesson(userId: string, courseId: string, lessonId: string) {
  const lesson = await prisma.lesson.findFirst({ where: { id: lessonId, module: { courseId } }, select: { id: true, contentType: true } });
  if (!lesson) throw new NotFoundError('Lesson');
  if (lesson.contentType === 'QUIZ') throw new ValidationError('Submit the lesson quiz to mark this lesson complete');
  return saveLessonCompletion(userId, courseId, lessonId);
}

async function saveLessonCompletion(userId: string, courseId: string, lessonId: string) {
  const allLessons = await prisma.lesson.findMany({ where: { module: { courseId } }, select: { id: true } });
  const lessonIds = new Set(allLessons.map((lesson) => lesson.id));
  if (!lessonIds.has(lessonId)) throw new NotFoundError('Lesson');

  let result: {
    enrollment: Awaited<ReturnType<typeof prisma.enrollment.findUniqueOrThrow>>;
    certificateId: string | null;
    newlyCompleted: boolean;
  } | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const current = await tx.enrollment.findUnique({ where: { courseId_userId: { courseId, userId } } });
        if (!current || current.status === 'DROPPED') {
          throw new ForbiddenError('Enroll in the course before tracking lesson progress');
        }

        const completed = new Set(current.completedLessonIds.filter((id) => lessonIds.has(id)));
        completed.add(lessonId);
        const allDone = allLessons.length > 0 && allLessons.every((lesson) => completed.has(lesson.id));
        const newlyCompleted = allDone && current.status !== 'COMPLETED';
        const progressPct = allLessons.length ? Math.round((completed.size / allLessons.length) * 100) : 0;
        const now = new Date();
        let enrollment = await tx.enrollment.update({
          where: { id: current.id },
          data: {
            completedLessonIds: [...completed],
            progressPct,
            status: allDone ? 'COMPLETED' : 'IN_PROGRESS',
            lastViewedAt: now,
            completedAt: allDone ? (current.completedAt ?? now) : null,
          },
        });

        let certificateId = enrollment.certificateId;
        if (allDone && !certificateId) {
          const [course, user] = await Promise.all([
            tx.course.findUnique({ where: { id: courseId }, select: { title: true, skillIds: true } }),
            tx.user.findUnique({ where: { id: userId }, select: { collegeId: true, studentProfile: { select: { id: true } } } }),
          ]);
          if (course && user?.collegeId) {
            const certificate = await tx.certificate.create({
              data: {
                certificateId: generateCertificateId(),
                studentId: userId,
                collegeId: user.collegeId,
                type: 'COURSE_COMPLETION',
                status: 'ISSUED',
                title: `${course.title} — Course Completion`,
                description: `Completed all lessons in ${course.title}.`,
                courseId,
              },
              select: { id: true },
            });
            certificateId = certificate.id;
            enrollment = await tx.enrollment.update({
              where: { id: current.id },
              data: { certificateId },
            });
            if (user.studentProfile && course.skillIds.length > 0) {
              const skills = await tx.skill.findMany({ where: { id: { in: course.skillIds }, isActive: true }, select: { id: true } });
              for (const skill of skills) {
                const existing = await tx.studentSkill.findUnique({
                  where: { studentProfileId_skillId: { studentProfileId: user.studentProfile.id, skillId: skill.id } },
                  select: { score: true },
                });
                const score = Math.max(existing?.score ?? 0, 60);
                await tx.studentSkill.upsert({
                  where: { studentProfileId_skillId: { studentProfileId: user.studentProfile.id, skillId: skill.id } },
                  create: { studentProfileId: user.studentProfile.id, skillId: skill.id, proficiency: proficiencyForScore(score), score, source: 'COURSE', isVerified: true, verifiedAt: now },
                  update: { proficiency: proficiencyForScore(score), score, source: 'COURSE', isVerified: true, verifiedAt: now },
                });
              }
            }
          }
        }
        if (newlyCompleted) await tx.course.update({ where: { id: courseId }, data: { completionCount: { increment: 1 } } });
        return { enrollment, certificateId, newlyCompleted };
      }, { isolationLevel: 'Serializable' });
      break;
    } catch (error) {
      const serializationConflict = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
      if (!serializationConflict || attempt === 2) throw error;
    }
  }

  if (!result) throw new Error('Lesson completion transaction did not return a result');

  if (result.newlyCompleted) await recalculateReadiness(userId);
  return result;
}

export async function markLessonComplete(userId: string, courseId: string, lessonId: string) {
  return completeLesson(userId, courseId, lessonId);
}

export async function submitLessonQuiz(userId: string, courseId: string, lessonId: string, answers: Record<string, string>) {
  const lesson = await prisma.lesson.findFirst({ where: { id: lessonId, module: { courseId } }, select: { id: true, quiz: true } });
  if (!lesson) throw new NotFoundError('Lesson');
  const enrollment = await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId, userId } } });
  if (!enrollment || enrollment.status === 'DROPPED') throw new ForbiddenError('Enroll in the course before submitting a quiz');
  const quiz = readQuiz(lesson.quiz);
  if (!quiz) throw new ValidationError('This lesson has no quiz configured');
  let correct = 0;
  for (const question of quiz.questions) if (answers[question.id] === question.correctOptionId) correct += 1;
  const score = quiz.questions.length ? Math.round((correct / quiz.questions.length) * 100) : 0;
  const passed = score >= quiz.passScore;
  const completion = passed ? await saveLessonCompletion(userId, courseId, lessonId) : null;
  return {
    score,
    passed,
    correct,
    total: quiz.questions.length,
    explanations: quiz.questions.map((question) => ({ id: question.id, correctOptionId: question.correctOptionId, selectedOptionId: answers[question.id] ?? null, explanation: question.explanation ?? null })),
    progress: completion?.enrollment ?? enrollment,
    certificateId: completion?.certificateId ?? null,
  };
}

export async function generateRoadmap(userId: string, collegeId: string | null, track: string, weeklyHoursAvailable: number) {
  return buildRoadmap(userId, collegeId, track, weeklyHoursAvailable);
}
