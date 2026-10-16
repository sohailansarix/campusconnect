import { Router } from 'express';
import { z } from 'zod';
import { commonSchemas, feedbackSchemas } from '@campusconnect/shared';
import * as controller from './feedback.controller.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { requirePermission, assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { publicReadLimiter } from '../../middleware/rateLimit.js';

export const feedbackRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public reads                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Public reviews, so a prospective attendee can read them before registering.
 * `optionalAuth` lets a signed-in visitor additionally see which entry is theirs.
 */
feedbackRouter.get(
  '/events/:id/feedback',
  assertPublicOrGuarded('Reviews are a public trust signal on the event page'),
  optionalAuth,
  publicReadLimiter,
  validateParams(commonSchemas.idParamSchema),
  validateQuery(feedbackSchemas.feedbackListQuerySchema),
  asyncHandler(controller.listForEvent),
);

/* -------------------------------------------------------------------------- */
/* Authenticated                                                              */
/* -------------------------------------------------------------------------- */

feedbackRouter.use(authenticate);

feedbackRouter.post(
  '/events/:id/feedback',
  requirePermission('feedback:create'),
  validateParams(commonSchemas.idParamSchema),
  validateBody(feedbackSchemas.createFeedbackSchema),
  asyncHandler(controller.create),
);

feedbackRouter.get(
  '/events/:id/feedback/mine',
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.getMine),
);

feedbackRouter.patch(
  '/events/:id/feedback/mine',
  validateParams(commonSchemas.idParamSchema),
  validateBody(feedbackSchemas.createFeedbackSchema.partial()),
  asyncHandler(controller.updateMine),
);

/* -------------------------------------------------------------------------- */
/* Organiser                                                                  */
/* -------------------------------------------------------------------------- */

feedbackRouter.get(
  '/events/:id/feedback/summary',
  requirePermission('event:view_analytics'),
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.summary),
);

feedbackRouter.get(
  '/events/:id/feedback/pending',
  requirePermission('event:view_analytics'),
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.pending),
);

feedbackRouter.patch(
  '/feedback/:feedbackId/moderate',
  requirePermission('moderation:manage', 'feedback:read'),
  validateBody(
    // `hidden` is required so the caller cannot send an empty body and silently
    // no-op, which would look like a successful moderation.
    z.object({
      hidden: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }),
  ),
  asyncHandler(controller.moderate),
);
