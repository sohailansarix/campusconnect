import type { Request, Response } from 'express';
import type { z } from 'zod';
import { feedbackSchemas, commonSchemas } from '@campusconnect/shared';
import * as feedbackService from './feedback.service.js';
import { requireUser } from '../../middleware/auth.js';
import { auditContextOf } from '../../utils/requestContext.js';
import { roleHasPermission } from '@campusconnect/shared';
import { assertFound } from '../../utils/errors.js';
import { prisma } from '../../config/prisma.js';

function viewerOf(req: Request) {
  const user = req.user;
  return {
    id: user?.id,
    canModerate: user ? roleHasPermission(user.role, 'feedback:read') : false,
  };
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as { id: string };
  const body = req.body as z.infer<typeof feedbackSchemas.createFeedbackSchema>;

  const feedback = await feedbackService.create(id, user.id, body, auditContextOf(req));

  res.status(201).json({
    success: true,
    data: { ...feedback, message: 'Thanks — your feedback helps organisers improve.' },
  });
}

/**
 * Public-facing reviews for an event.
 *
 * Anonymous entries have no author attached. This endpoint is unauthenticated so a
 * prospective attendee can read reviews before registering; it is therefore
 * deliberately separate from the organiser's list, which includes hidden entries.
 */
export async function listForEvent(req: Request, res: Response): Promise<void> {
  const viewer = viewerOf(req);
  const { id } = req.params as { id: string };
  const query = req.query as z.infer<typeof feedbackSchemas.feedbackListQuerySchema>;

  const result = await feedbackService.listForEvent(
    id,
    {
      page: query.page,
      pageSize: query.pageSize,
      minRating: query.minRating,
      maxRating: query.maxRating,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    },
    viewer,
  );

  res.json({ success: true, data: result.items, meta: { ...result.meta, summary: result.summary } });
}

export async function getMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as { id: string };

  const feedback = await feedbackService.getMine(id, user.id);
  res.json({ success: true, data: feedback });
}

export async function updateMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as { id: string };
  const body = req.body as Partial<z.infer<typeof feedbackSchemas.createFeedbackSchema>>;

  const feedback = await feedbackService.updateMine(id, user.id, body, auditContextOf(req));
  res.json({ success: true, data: feedback });
}

export async function summary(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };

  // Verify the event exists before computing aggregates, so a bad id is a clean
  // 404 rather than an empty summary that looks like "no feedback yet".
  assertFound(
    await prisma.event.findFirst({ where: { id }, select: { id: true } }),
    'Event',
  );

  const result = await feedbackService.summarise(id);
  res.json({ success: true, data: result });
}

export async function pending(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = req.params as { id: string };

  const pending = await feedbackService.pendingFeedback(id, user.collegeId);
  res.json({ success: true, data: { count: pending.length, students: pending.slice(0, 100) } });
}

export async function moderate(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { feedbackId } = req.params as { feedbackId: string };
  const body = req.body as { hidden: boolean; reason?: string };

  await feedbackService.setHidden(
    feedbackId,
    body.hidden,
    body.reason,
    { id: user.id, collegeId: user.collegeId, isSuperAdmin: user.role === 'SUPER_ADMIN' },
    auditContextOf(req),
  );

  res.json({ success: true, data: { hidden: body.hidden } });
}
