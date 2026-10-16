import { Router } from 'express';
import { authSchemas, commonSchemas } from '@campusconnect/shared';
import * as controller from './auth.controller.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  authLimiter,
  passwordResetLimiter,
  refreshLimiter,
} from '../../middleware/rateLimit.js';
import { asyncHandler } from '../../middleware/error.js';
import { assertPublicOrGuarded } from '../../middleware/rbac.js';
import { z } from 'zod';

/**
 * Auth routes.
 *
 * Rate limiting is applied per-endpoint rather than globally, because the budgets
 * differ by an order of magnitude: a login attempt is expensive and abusable,
 * while reading your own principal is neither.
 */

export const authRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Public because the user has no session yet — this is how one is obtained.
 * Rate limited per IP+email so neither one address nor one account can be
 * hammered.
 */
authRouter.post(
  '/register',
  assertPublicOrGuarded('Account creation is necessarily unauthenticated'),
  authLimiter,
  validateBody(authSchemas.register),
  asyncHandler(controller.register),
);

authRouter.post(
  '/login',
  assertPublicOrGuarded('Signing in is unauthenticated by definition'),
  authLimiter,
  validateBody(authSchemas.login),
  asyncHandler(controller.login),
);

authRouter.post(
  '/refresh',
  assertPublicOrGuarded('A refresh token is the credential for this route'),
  refreshLimiter,
  asyncHandler(controller.refresh),
);

authRouter.post(
  '/forgot-password',
  assertPublicOrGuarded('A locked-out user has no session to authenticate with'),
  passwordResetLimiter,
  validateBody(authSchemas.forgotPassword),
  asyncHandler(controller.forgotPassword),
);

authRouter.post(
  '/reset-password',
  assertPublicOrGuarded('The emailed token is the credential for this route'),
  passwordResetLimiter,
  validateBody(authSchemas.resetPassword),
  asyncHandler(controller.resetPassword),
);

authRouter.post(
  '/verify-email',
  assertPublicOrGuarded('The emailed token is the credential for this route'),
  passwordResetLimiter,
  validateBody(authSchemas.verifyEmail),
  asyncHandler(controller.verifyEmail),
);

authRouter.post(
  '/accept-invite',
  assertPublicOrGuarded('The invitation token is the credential for this route'),
  passwordResetLimiter,
  validateBody(
    z
      .object({
        token: z.string().min(20),
        password: authSchemas.resetPassword.shape.password,
        confirmPassword: z.string(),
      })
      .refine((v) => v.password === v.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
      }),
  ),
  asyncHandler(controller.acceptInvite),
);

/* -------------------------------------------------------------------------- */
/* Authenticated                                                              */
/* -------------------------------------------------------------------------- */

authRouter.use(authenticate);

authRouter.get('/me', asyncHandler(controller.me));

authRouter.post('/logout', asyncHandler(controller.logout));

authRouter.post(
  '/change-password',
  validateBody(authSchemas.changePassword),
  asyncHandler(controller.changePassword),
);

authRouter.post('/resend-verification', asyncHandler(controller.resendVerification));

/** Only college admins and above may provision accounts. */
authRouter.post(
  '/invite',
  requirePermission('user:create'),
  validateBody(authSchemas.invite),
  asyncHandler(controller.invite),
);

authRouter.get('/sessions', asyncHandler(controller.listSessions));

authRouter.delete(
  '/sessions/:id',
  validateParams(commonSchemas.idParamSchema),
  asyncHandler(controller.revokeSession),
);

authRouter.post('/sessions/revoke-all', asyncHandler(controller.revokeAllSessions));
