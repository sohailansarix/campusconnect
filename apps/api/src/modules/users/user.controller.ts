import type { Request, Response } from 'express';
import { userSchemas, commonSchemas } from '@campusconnect/shared';
import type { z } from 'zod';
import * as userService from './user.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { ForbiddenError } from '../../utils/errors.js';
import { ensureUsername } from './user.service.js';

/** Users controller — validation and response shaping only. */

function isSuperAdmin(req: Request): boolean {
  return req.user?.role === 'SUPER_ADMIN';
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const filters = req.query as z.infer<typeof userSchemas.userListQuerySchema>;

  const result = await userService.list(filters, {
    collegeId: user.collegeId,
    isSuperAdmin: isSuperAdmin(req),
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

/** The caller's own profile. Always permitted. */
export async function me(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const profile = await userService.getById(user.id);
  res.json({ success: true, data: profile });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const caller = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;

  const profile = await userService.getById(id);

  // Tenant check: a non-super-admin may only read users in their own college
  // unless the profile is publicly visible.
  if (!isSuperAdmin(req) && profile.college?.id !== caller.collegeId) {
    const target = await userService.getByUsername(profile.username ?? '');
    if (target.profile?.passportVisibility !== 'PUBLIC') {
      throw new ForbiddenError('That profile belongs to another institution');
    }
  }

  res.json({ success: true, data: profile });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof userSchemas.updateUserSchema>;

  const profile = await userService.updateUser(user.id, body, auditContextOf(req));
  res.json({ success: true, data: profile });
}

export async function updateMyProfile(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof userSchemas.updateStudentProfileSchema>;

  const profile = await userService.updateStudentProfile(user.id, body, auditContextOf(req));
  res.json({ success: true, data: profile });
}

/**
 * Grants the caller a username if they do not have one, and returns it.
 *
 * The web app calls this when the student first opens their passport, so an
 * account created before usernames existed still gets a shareable URL.
 */
export async function claimUsername(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const username = await ensureUsername(user.id);
  res.json({ success: true, data: { username } });
}

/* -------------------------------------------------------------------------- */
/* Administrative                                                             */
/* -------------------------------------------------------------------------- */

export async function setStatus(req: Request, res: Response): Promise<void> {
  const caller = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;
  const { status } = req.body as { status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' };

  await userService.setStatus(id, status, {
    id: caller.id,
    collegeId: caller.collegeId,
    isSuperAdmin: isSuperAdmin(req),
  }, auditContextOf(req));

  res.json({ success: true, data: { id, status } });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const caller = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;

  await userService.softDelete(
    id,
    { id: caller.id, collegeId: caller.collegeId, isSuperAdmin: isSuperAdmin(req) },
    auditContextOf(req),
  );

  res.status(204).send();
}
