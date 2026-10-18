import type { Request, Response } from 'express';
import type { z } from 'zod';
import { skillSchemas } from '@campusconnect/shared';
import { requireUser } from '../../middleware/auth.js';
import * as service from './skills.service.js';

export async function listAssessments(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as z.infer<typeof skillSchemas.assessmentListQuerySchema>;
  const result = await service.listAssessments(query, req.user?.collegeId ?? null);
  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function getAssessment(req: Request, res: Response): Promise<void> {
  const result = await service.getAssessment(req.params.id!, req.user?.collegeId ?? null, req.user?.id ?? null);
  res.json({ success: true, data: result });
}

export async function startAttempt(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await service.startAttempt(req.params.assessmentId!, user.id, user.collegeId);
  res.status(201).json({ success: true, data: result });
}

export async function submitAttempt(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof skillSchemas.submitAssessmentSchema>;
  const result = await service.submitAttempt(req.params.assessmentId!, req.params.attemptId!, user.id, body.answers);
  res.json({ success: true, data: result });
}

export async function myAttempts(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.listMyAttempts(user.id) });
}

export async function mySkills(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.listMySkills(user.id) });
}
