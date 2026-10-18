import { z } from 'zod';
import { listQuerySchema, urlOrPathSchema } from './common.js';

export const projectListQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  caseStudy: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

export const projectSubmissionSchema = z.object({
  summary: z.string().trim().min(20).max(4000),
  submissionNote: z.string().trim().max(2000).optional(),
  repoUrl: z.string().url().max(500).optional().or(z.literal('')),
  liveUrl: z.string().url().max(500).optional().or(z.literal('')),
  fileUrl: urlOrPathSchema.optional().or(z.literal('')),
  thumbnailUrl: urlOrPathSchema.optional().or(z.literal('')),
});

export const projectReviewSchema = z.object({
  rubric: z.array(z.object({
    criterion: z.string().trim().min(2).max(120),
    maxPoints: z.number().int().positive().max(100),
    score: z.number().int().min(0).max(100),
    comment: z.string().trim().max(1000).optional(),
  })).min(1).max(12),
  feedback: z.string().trim().min(20).max(4000),
  strengths: z.array(z.string().trim().min(2).max(300)).max(12).default([]),
  improvements: z.array(z.string().trim().min(2).max(300)).max(12).default([]),
  decision: z.enum(['APPROVED', 'NEEDS_REVISION', 'REJECTED']),
});
