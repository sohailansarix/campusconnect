import { Router } from 'express';
import { z } from 'zod';
import { resumeSchemas } from '@campusconnect/shared';
import * as controller from './resumes.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';

export const resumeRouter = Router();
resumeRouter.use(authenticate, requirePermission('resume:manage'));
resumeRouter.get('/mine', asyncHandler(controller.listMine));
resumeRouter.post('/from-passport', asyncHandler(controller.createFromPassport));
resumeRouter.post('/', validateBody(resumeSchemas.createResumeSchema), asyncHandler(controller.create));
resumeRouter.patch('/:id', validateParams(z.object({ id: z.string().cuid() })), validateBody(resumeSchemas.updateResumeSchema), asyncHandler(controller.update));
resumeRouter.post('/:id/review', validateParams(z.object({ id: z.string().cuid() })), asyncHandler(controller.review));
resumeRouter.get('/:id/pdf', validateParams(z.object({ id: z.string().cuid() })), asyncHandler(controller.exportPdf));
