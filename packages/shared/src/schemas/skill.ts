import { z } from 'zod';
import { listQuerySchema } from './common.js';

export const assessmentListQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  kind: z.enum(['SKILL', 'INTEREST']).optional(),
  categoryId: z.string().cuid().optional(),
});

export const assessmentAnswerSchema = z.record(z.string().min(1), z.string().min(1));

export const submitAssessmentSchema = z.object({
  answers: assessmentAnswerSchema,
});
export type SubmitAssessmentInput = z.infer<typeof submitAssessmentSchema>;
