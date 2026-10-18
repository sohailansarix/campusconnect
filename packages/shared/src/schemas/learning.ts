import { z } from 'zod';
import { COURSE_LEVELS } from '../constants.js';
import { listQuerySchema } from './common.js';

export const courseListQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  premium: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

export const roadmapGenerateSchema = z.object({
  track: z.string().trim().min(2).max(100),
  weeklyHoursAvailable: z.coerce.number().int().min(1).max(60).default(5),
});

export const roadmapProgressSchema = z.object({
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']),
  progressPct: z.number().int().min(0).max(100),
});

export const lessonQuizSubmissionSchema = z.object({
  answers: z.record(z.string().min(1), z.string().min(1)),
});
