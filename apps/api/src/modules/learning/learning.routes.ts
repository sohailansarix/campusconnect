import { Router } from 'express';
import { z } from 'zod';
import { learningSchemas } from '@campusconnect/shared';
import * as controller from './learning.controller.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { requirePermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { publicReadLimiter } from '../../middleware/rateLimit.js';

export const courseRouter = Router();
courseRouter.get('/mine/enrollments', authenticate, asyncHandler(controller.myEnrollments));
courseRouter.get('/', assertPublicOrGuarded('The course catalogue is public'), optionalAuth, publicReadLimiter, validateQuery(learningSchemas.courseListQuerySchema), asyncHandler(controller.listCourses));
courseRouter.get('/:slug', assertPublicOrGuarded('Course previews are public'), optionalAuth, publicReadLimiter, validateParams(z.object({ slug: z.string().trim().min(1).max(160) })), asyncHandler(controller.getCourse));
courseRouter.post('/:courseId/enroll', authenticate, requirePermission('course:enroll'), validateParams(z.object({ courseId: z.string().cuid() })), asyncHandler(controller.enrollCourse));
courseRouter.post('/:courseId/lessons/:lessonId/complete', authenticate, requirePermission('course:enroll'), validateParams(z.object({ courseId: z.string().cuid(), lessonId: z.string().cuid() })), asyncHandler(controller.completeLesson));
courseRouter.post('/:courseId/lessons/:lessonId/quiz', authenticate, requirePermission('course:enroll'), validateParams(z.object({ courseId: z.string().cuid(), lessonId: z.string().cuid() })), validateBody(learningSchemas.lessonQuizSubmissionSchema), asyncHandler(controller.submitQuiz));

export const roadmapRouter = Router();
roadmapRouter.get('/tracks', assertPublicOrGuarded('Career track options are public'), asyncHandler(controller.listTracks));
roadmapRouter.get('/mine', authenticate, asyncHandler(controller.myRoadmap));
roadmapRouter.post('/generate', authenticate, requirePermission('assessment:take'), validateBody(learningSchemas.roadmapGenerateSchema), asyncHandler(controller.generateRoadmap));
roadmapRouter.patch('/:roadmapId/steps/:stepId', authenticate, requirePermission('assessment:take'), validateParams(z.object({ roadmapId: z.string().cuid(), stepId: z.string().cuid() })), validateBody(learningSchemas.roadmapProgressSchema), asyncHandler(controller.updateRoadmapStep));
