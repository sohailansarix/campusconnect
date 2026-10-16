import type { Request, Response } from 'express';
import type { z } from 'zod';
import { commonSchemas, userSchemas } from '@campusconnect/shared';
import * as collegeService from './college.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf, auditContextFor } from '../../utils/requestContext.js';
import { ForbiddenError } from '../../utils/errors.js';

function isSuperAdmin(req: Request): boolean {
  return req.user?.role === 'SUPER_ADMIN';
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/** Feeds the signup form. No authentication, no sensitive fields. */
export async function listPublic(req: Request, res: Response): Promise<void> {
  const { search } = req.query as { search?: string };
  const colleges = await collegeService.listPublic({ search });
  res.json({ success: true, data: colleges });
}

export async function getPublic(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const college = await collegeService.getById(id);
  res.json({ success: true, data: college });
}

/* -------------------------------------------------------------------------- */
/* College admin                                                              */
/* -------------------------------------------------------------------------- */

export async function getMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  if (!user.collegeId) throw new ForbiddenError('Your account is not linked to a college');

  const college = await collegeService.getById(user.collegeId, { includeCounts: true });
  res.json({ success: true, data: college });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as { id: string };

  collegeService.assertCollegeAccess(
    { collegeId: user.collegeId, isSuperAdmin: isSuperAdmin(req) },
    id,
  );

  await collegeService.updateCollege(id, req.body as Record<string, never>, auditContextFor(req, id));
  const college = await collegeService.getById(id, { includeCounts: true });

  res.json({ success: true, data: college });
}

/* -------------------------------------------------------------------------- */
/* Departments                                                                */
/* -------------------------------------------------------------------------- */

export async function createDepartment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as { id: string };

  collegeService.assertCollegeAccess(
    { collegeId: user.collegeId, isSuperAdmin: isSuperAdmin(req) },
    id,
  );

  const department = await collegeService.createDepartment(
    id,
    req.body as { name: string; code: string },
    auditContextFor(req, id),
  );

  res.status(201).json({ success: true, data: department });
}

export async function updateDepartment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { departmentId } = req.params as { departmentId: string };

  if (!user.collegeId) throw new ForbiddenError('Your account is not linked to a college');

  const department = await collegeService.updateDepartment(
    departmentId,
    user.collegeId,
    req.body as Record<string, never>,
    auditContextOf(req),
  );

  res.json({ success: true, data: department });
}

export async function deactivateDepartment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { departmentId } = req.params as { departmentId: string };

  if (!user.collegeId) throw new ForbiddenError('Your account is not linked to a college');

  const result = await collegeService.deactivateDepartment(
    departmentId,
    user.collegeId,
    auditContextOf(req),
  );

  res.json({ success: true, data: result });
}

/* -------------------------------------------------------------------------- */
/* Platform operator                                                          */
/* -------------------------------------------------------------------------- */

export async function listAll(req: Request, res: Response): Promise<void> {
  const filters = req.query as z.infer<typeof userSchemas.userListQuerySchema>;

  const result = await collegeService.listAllForAdmin({
    page: filters.page,
    pageSize: filters.pageSize,
    search: filters.search,
  });

  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function create(req: Request, res: Response): Promise<void> {
  const college = await collegeService.createCollege(
    req.body as never,
    auditContextOf(req),
  );

  res.status(201).json({ success: true, data: college });
}

export async function refreshCounters(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as z.infer<typeof commonSchemas.idParamSchema>;

  collegeService.assertCollegeAccess(
    { collegeId: user.collegeId, isSuperAdmin: isSuperAdmin(req) },
    id,
  );

  await collegeService.refreshCounters(id);
  res.json({ success: true, data: { refreshed: true } });
}
