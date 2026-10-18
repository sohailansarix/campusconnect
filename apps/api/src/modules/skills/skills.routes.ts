import { Router } from 'express';
import { z } from 'zod';
import { skillSchemas } from '@campusconnect/shared';
import * as controller from './skills.controller.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { requirePermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { publicReadLimiter } from '../../middleware/rateLimit.js';

export const skillsRouter = Router();

skillsRouter.get('/assessments', assertPublicOrGuarded('Assessment catalogue is readable before login'), optionalAuth, publicReadLimiter, validateQuery(skillSchemas.assessmentListQuerySchema), asyncHandler(controller.listAssessments));
skillsRouter.get('/assessments/mine/attempts', authenticate, asyncHandler(controller.myAttempts));
skillsRouter.get('/mine', authenticate, asyncHandler(controller.mySkills));
skillsRouter.get('/assessments/:id', assertPublicOrGuarded('Assessment details are a public catalogue surface'), optionalAuth, publicReadLimiter, validateParams(z.object({ id: z.string().cuid() })), asyncHandler(controller.getAssessment));

skillsRouter.post('/assessments/:assessmentId/attempts', authenticate, requirePermission('assessment:take'), validateParams(z.object({ assessmentId: z.string().cuid() })), asyncHandler(controller.startAttempt));
skillsRouter.post('/assessments/:assessmentId/attempts/:attemptId/submit', authenticate, requirePermission('assessment:take'), validateParams(z.object({ assessmentId: z.string().cuid(), attemptId: z.string().cuid() })), validateBody(skillSchemas.submitAssessmentSchema), asyncHandler(controller.submitAttempt));
