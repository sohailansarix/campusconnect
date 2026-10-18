import type { Request, Response } from 'express';
import type { z } from 'zod';
import { learningSchemas } from '@campusconnect/shared';
import { requireUser } from '../../middleware/auth.js';
import * as service from './learning.service.js';

export async function listCourses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as z.infer<typeof learningSchemas.courseListQuerySchema>;
  const result = await service.listCourses(query, req.user?.id ?? null, req.user?.collegeId ?? null);
  res.json({ success: true, data: result.items, meta: result.meta });
}

export async function getCourse(req: Request, res: Response): Promise<void> {
  const result = await service.getCourse(req.params.slug!, req.user?.id ?? null, req.user?.collegeId ?? null);
  res.json({ success: true, data: result });
}

export async function enrollCourse(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await service.enrollCourse(req.params.courseId!, user.id, user.collegeId);
  res.status(201).json({ success: true, data: result });
}

export async function myEnrollments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.myEnrollments(user.id) });
}

export async function completeLesson(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await service.markLessonComplete(user.id, req.params.courseId!, req.params.lessonId!);
  res.json({ success: true, data: result });
}

export async function submitQuiz(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof learningSchemas.lessonQuizSubmissionSchema>;
  const result = await service.submitLessonQuiz(user.id, req.params.courseId!, req.params.lessonId!, body.answers);
  res.json({ success: true, data: result });
}

export async function listTracks(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: service.listCareerTracks() });
}

export async function myRoadmap(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: await service.getRoadmap(user.id) });
}

export async function generateRoadmap(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof learningSchemas.roadmapGenerateSchema>;
  const result = await service.generateRoadmap(user.id, user.collegeId, body.track, body.weeklyHoursAvailable);
  res.status(201).json({ success: true, data: result });
}

export async function updateRoadmapStep(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof learningSchemas.roadmapProgressSchema>;
  const result = await service.updateRoadmapProgress(user.id, req.params.roadmapId!, req.params.stepId!, body);
  res.json({ success: true, data: result });
}
