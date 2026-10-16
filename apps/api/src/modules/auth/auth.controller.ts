import type { Request, Response } from 'express';
import { z } from 'zod';
import { authSchemas, ROLE_HOME } from '@campusconnect/shared';
import * as authService from './auth.service.js';
import { requireUser } from '../../middleware/auth.js';
import { writeAudit } from '../../utils/audit.js';
import { UnauthenticatedError } from '../../utils/errors.js';
import { extractBearerToken } from '../../utils/jwt.js';
import { env } from '../../config/env.js';

/**
 * Auth controller.
 *
 * Thin by design: validate → call the service → shape the response. Every piece
 * of business logic (timing parity, rotation, reuse detection) lives in the
 * service, so it is testable without an HTTP layer.
 */

type RegisterBody = z.infer<typeof authSchemas.register>;
type LoginBody = z.infer<typeof authSchemas.login>;

/** Request context shared by every auth handler, for audit and session rows. */
function contextOf(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * Response shape for a successful authentication.
 *
 * The refresh token is returned in the body *and* as an httpOnly cookie. The body
 * is what a mobile or third-party client uses; the cookie is what the Next.js app
 * uses so its server-side fetches do not have to hold tokens in JS-accessible
 * storage. `httpOnly` is what keeps an XSS from stealing the long-lived token.
 */
function sendAuthResult(
  res: Response,
  result: { user: unknown; tokens: { accessToken: string; refreshToken: string; expiresIn: number } },
  status = 200,
) {
  const isProduction = env.isProduction;

  res.cookie('cc_refresh', result.tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/api/v1/auth',
    maxAge: authService.authConfig.refreshTtlSeconds * 1000,
  });

  res.status(status).json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn,
      /** Where the client should navigate after signing in. */
      home: ROLE_HOME[(result.user as { role: keyof typeof ROLE_HOME }).role] ?? '/dashboard',
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Register / login / logout                                                  */
/* -------------------------------------------------------------------------- */

export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as RegisterBody;
  const result = await authService.register(body, contextOf(req));

  writeAudit(
    { userId: result.user.id, collegeId: result.user.collegeId, ipAddress: req.ip, requestId: req.requestId },
    'CREATE',
    'User',
    result.user.id,
    { method: 'signup', role: 'STUDENT' },
  );

  sendAuthResult(res, result, 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as LoginBody;
  const result = await authService.login(body, contextOf(req));

  req.log?.info('User signed in', { userId: result.user.id, role: result.user.role });

  writeAudit(
    { userId: result.user.id, collegeId: result.user.collegeId, ipAddress: req.ip, requestId: req.requestId },
    'LOGIN',
    'Session',
    null,
    { role: result.user.role },
  );

  sendAuthResult(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  // Cookie first (web app), then body (native/third-party clients).
  const cookies = req.cookies as Record<string, string> | undefined;
  const token = cookies?.cc_refresh ?? (req.body as { refreshToken?: string } | undefined)?.refreshToken;

  if (!token) throw new UnauthenticatedError('No session to refresh');

  const result = await authService.refresh(token, contextOf(req));
  sendAuthResult(res, result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const cookies = req.cookies as Record<string, string> | undefined;
  const body = req.body as { refreshToken?: string; allDevices?: boolean } | undefined;

  await authService.logout(user.id, {
    refreshToken: body?.refreshToken ?? cookies?.cc_refresh,
    allDevices: body?.allDevices ?? false,
  });

  res.clearCookie('cc_refresh', { path: '/api/v1/auth' });

  writeAudit(
    { userId: user.id, collegeId: user.collegeId, ipAddress: req.ip, requestId: req.requestId },
    'LOGOUT',
    'Session',
    null,
    { allDevices: body?.allDevices ?? false },
  );

  res.json({ success: true, data: { signedOut: true } });
}

/* -------------------------------------------------------------------------- */
/* Password reset / change                                                    */
/* -------------------------------------------------------------------------- */

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as z.infer<typeof authSchemas.forgotPassword>;

  // Always the same response, whether or not the account exists.
  await authService.requestPasswordReset(email, contextOf(req));

  res.json({
    success: true,
    data: {
      message: 'If an account exists for that email, a reset link is on its way.',
    },
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as z.infer<typeof authSchemas.resetPassword>;
  await authService.resetPassword(token, password);

  res.json({
    success: true,
    data: { message: 'Your password has been reset. Sign in with your new password.' },
  });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { currentPassword, newPassword } = req.body as z.infer<typeof authSchemas.changePassword>;

  await authService.changePassword(user.id, currentPassword, newPassword);

  // Changing a password revokes every session server-side. The caller is signed
  // out of this device too, so it must sign in again — returning a fresh token
  // pair here would defeat the purpose of the revocation.
  res.clearCookie('cc_refresh', { path: '/api/v1/auth' });

  writeAudit(
    { userId: user.id, collegeId: user.collegeId, ipAddress: req.ip, requestId: req.requestId },
    'UPDATE',
    'User',
    user.id,
    { field: 'password' },
  );

  res.json({
    success: true,
    data: { message: 'Password changed. Please sign in again on all devices.' },
  });
}

/* -------------------------------------------------------------------------- */
/* Email verification / invitations                                           */
/* -------------------------------------------------------------------------- */

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { token } = req.body as z.infer<typeof authSchemas.verifyEmail>;
  await authService.verifyEmail(token);
  res.json({ success: true, data: { verified: true } });
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await authService.sendEmailVerification(user.id, contextOf(req));
  res.json({ success: true, data: { message: 'Verification email sent.' } });
}

export async function invite(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof authSchemas.invite>;

  const result = await authService.inviteUser(body, user.id, contextOf(req));

  res.status(201).json({
    success: true,
    data: {
      userId: result.userId,
      message: `Invitation sent to ${body.email}. They must set a password before signing in.`,
    },
  });
}

export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const body = req.body as { token: string; password: string; confirmPassword: string };
  const result = await authService.acceptInvite(body.token, body.password, contextOf(req));

  res.status(201).json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn,
      home: ROLE_HOME[result.user.role] ?? '/dashboard',
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Session introspection                                                      */
/* -------------------------------------------------------------------------- */

/** Returns the caller's principal. Used by the web app's session bootstrap. */
export async function me(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({
    success: true,
    data: {
      user,
      home: ROLE_HOME[user.role] ?? '/dashboard',
    },
  });
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const sessions = await authService.listSessions(user.id);
  res.json({ success: true, data: { sessions } });
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as { id: string };

  // Ownership check: a caller may only revoke their own session. The service is
  // given the user id for exactly this reason.
  const sessions = await authService.listSessions(user.id);
  if (!sessions.some((session) => session.id === id)) {
    throw new UnauthenticatedError('That session does not belong to you');
  }

  await authService.revokeSession(id, 'Revoked from the sessions list');
  res.json({ success: true, data: { revoked: true } });
}

export async function revokeAllSessions(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const count = await authService.revokeAllSessions(user.id, 'Revoked by the account holder');
  res.clearCookie('cc_refresh', { path: '/api/v1/auth' });
  res.json({ success: true, data: { revokedCount: count } });
}

/** Exposed for the tests, which assert the cookie is never JS-readable. */
export const __test__ = { extractBearerToken };
