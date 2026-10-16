import { Router } from 'express';
import { passportSchemas } from '@campusconnect/shared';
import * as controller from './passport.controller.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { assertPublicOrGuarded } from '../../middleware/rbac.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { publicReadLimiter } from '../../middleware/rateLimit.js';

export const passportRouter = Router();

/* -------------------------------------------------------------------------- */
/* Owner routes — declared before /:username so they are not captured         */
/* -------------------------------------------------------------------------- */

passportRouter.get('/mine', authenticate, asyncHandler(controller.getMine));

passportRouter.get('/mine/trend', authenticate, asyncHandler(controller.trend));

passportRouter.post('/mine/recalculate', authenticate, asyncHandler(controller.recalculate));

passportRouter.put(
  '/mine/privacy',
  authenticate,
  validateBody(passportSchemas.passportPrivacySchema),
  asyncHandler(controller.updatePrivacy),
);

/* -------------------------------------------------------------------------- */
/* Public passport                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Unauthenticated so a shared link works — that is the entire point of a shareable
 * passport URL. Privacy is enforced inside the service, which returns 403 with a
 * human-readable reason for a passport the viewer may not see.
 *
 * `optionalAuth` adds viewer context when a session exists, which is what lets a
 * college officer see an institutional-only field and an owner see their own
 * private passport.
 */
passportRouter.get(
  '/:username',
  assertPublicOrGuarded('A shared passport link must work for anyone holding it'),
  optionalAuth,
  publicReadLimiter,
  validateParams(passportSchemas.usernameParamSchema),
  asyncHandler(controller.getByUsername),
);

passportRouter.get(
  '/:username/share',
  assertPublicOrGuarded('Sharing a passport is meaningless if the share card needs a login'),
  optionalAuth,
  publicReadLimiter,
  validateParams(passportSchemas.usernameParamSchema),
  asyncHandler(controller.share),
);

passportRouter.get(
  '/:username/export',
  assertPublicOrGuarded('Downloading a public passport PDF is equivalent to viewing it'),
  optionalAuth,
  publicReadLimiter,
  validateParams(passportSchemas.usernameParamSchema),
  asyncHandler(controller.exportPdf),
);
