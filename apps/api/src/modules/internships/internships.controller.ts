import type { Request, Response } from 'express';
import type { z } from 'zod';
import { internshipSchemas } from '@campusconnect/shared';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import * as service from './internships.service.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as z.infer<typeof internshipSchemas.internshipListQuerySchema>;
  const result = await service.listInternships(query, req.user?.collegeId ?? null);
  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.getInternship(req.params.slug!, req.user?.collegeId ?? null) });
}

export async function apply(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof internshipSchemas.applyForInternshipSchema>;
  const result = await service.applyForInternship(req.params.id!, user, body, auditContextOf(req));
  res.status(201).json({ success: true, data: result });
}

export async function mine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.listMyApplications(user.id) });
}
