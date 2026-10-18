import type { Request, Response } from 'express';
import type { z } from 'zod';
import { projectSchemas } from '@campusconnect/shared';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import * as service from './projects.service.js';

function reviewerOf(req: Request) {
  const user = requireUser(req);
  return { id: user.id, collegeId: user.collegeId, isSuperAdmin: user.role === 'SUPER_ADMIN' };
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as z.infer<typeof projectSchemas.projectListQuerySchema>;
  const result = await service.listProjects(query, user.collegeId, user.id);
  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.getProject(req.params.id!, user.id, user.collegeId) });
}

export async function mine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.listMySubmissions(user.id) });
}

export async function createSubmission(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof projectSchemas.projectSubmissionSchema>;
  const result = await service.createSubmission(req.params.id!, user.id, user.collegeId, body, auditContextOf(req));
  res.status(201).json({ success: true, data: result });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.submitSubmission(req.params.submissionId!, user.id, auditContextOf(req)) });
}

export async function updateSubmission(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof projectSchemas.projectSubmissionSchema>;
  res.json({ success: true, data: await service.updateSubmission(req.params.submissionId!, user.id, body, auditContextOf(req)) });
}

export async function pendingReviews(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.listPendingReviews(reviewerOf(req)) });
}

export async function review(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof projectSchemas.projectReviewSchema>;
  res.json({ success: true, data: await service.reviewSubmission(req.params.submissionId!, reviewerOf(req), body, auditContextOf(req)) });
}
