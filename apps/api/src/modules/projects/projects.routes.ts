import { Router } from 'express';
import { projectSchemas } from '@campusconnect/shared';
import * as controller from './projects.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { z } from 'zod';

export const projectRouter = Router();
projectRouter.use(authenticate);
projectRouter.get('/mine/submissions', requirePermission('project:submit'), asyncHandler(controller.mine));
projectRouter.get('/reviews/pending', requirePermission('project:review'), asyncHandler(controller.pendingReviews));
projectRouter.get('/', requirePermission('project:submit'), validateQuery(projectSchemas.projectListQuerySchema), asyncHandler(controller.list));
projectRouter.get('/:id', requirePermission('project:submit'), validateParams(z.object({ id: z.string().cuid() })), asyncHandler(controller.getOne));
projectRouter.post('/:id/submissions', requirePermission('project:submit'), validateParams(z.object({ id: z.string().cuid() })), validateBody(projectSchemas.projectSubmissionSchema), asyncHandler(controller.createSubmission));
projectRouter.patch('/submissions/:submissionId', requirePermission('project:submit'), validateParams(z.object({ submissionId: z.string().cuid() })), validateBody(projectSchemas.projectSubmissionSchema), asyncHandler(controller.updateSubmission));
projectRouter.post('/submissions/:submissionId/submit', requirePermission('project:submit'), validateParams(z.object({ submissionId: z.string().cuid() })), asyncHandler(controller.submit));
projectRouter.post('/submissions/:submissionId/review', requirePermission('project:review'), validateParams(z.object({ submissionId: z.string().cuid() })), validateBody(projectSchemas.projectReviewSchema), asyncHandler(controller.review));
