import type { Request, Response } from 'express';
import type { z } from 'zod';
import { resumeSchemas } from '@campusconnect/shared';
import { requireUser } from '../../middleware/auth.js';
import * as service from './resumes.service.js';

export async function listMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.listMine(user.id) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof resumeSchemas.createResumeSchema>;
  res.status(201).json({ success: true, data: await service.create(user.id, body) });
}

export async function createFromPassport(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.status(201).json({ success: true, data: await service.createFromPassport(user.id) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof resumeSchemas.updateResumeSchema>;
  res.json({ success: true, data: await service.update(user.id, req.params.id!, body) });
}

export async function review(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.review(user.id, req.params.id!) });
}

export async function exportPdf(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await service.exportPdf(user.id, req.params.id!);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${result.title.replace(/[^a-z0-9_-]+/gi, '-')}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.buffer);
}
