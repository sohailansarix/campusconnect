import { Router } from 'express';
import { z } from 'zod';
import { internshipSchemas } from '@campusconnect/shared';
import * as controller from './internships.controller.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { requirePermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { publicReadLimiter } from '../../middleware/rateLimit.js';

export const internshipRouter = Router();
internshipRouter.get('/', assertPublicOrGuarded('Internship discovery is public'), optionalAuth, publicReadLimiter, validateQuery(internshipSchemas.internshipListQuerySchema), asyncHandler(controller.list));
internshipRouter.get('/mine/applications', authenticate, requirePermission('internship:apply'), asyncHandler(controller.mine));
internshipRouter.get('/:slug', assertPublicOrGuarded('Published opportunities are public'), optionalAuth, publicReadLimiter, validateParams(z.object({ slug: z.string().trim().min(1).max(160) })), asyncHandler(controller.getOne));
internshipRouter.post('/:id/apply', authenticate, requirePermission('internship:apply'), validateParams(z.object({ id: z.string().cuid() })), validateBody(internshipSchemas.applyForInternshipSchema), asyncHandler(controller.apply));
