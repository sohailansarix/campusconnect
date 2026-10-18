import { z } from 'zod';
import { WORK_MODES } from '../constants.js';
import { listQuerySchema } from './common.js';

export const internshipListQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  opportunityKind: z.enum(['INTERNSHIP', 'INDUSTRY_PROJECT', 'APPRENTICESHIP']).optional(),
  location: z.string().trim().max(120).optional(),
  premium: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

export const applyForInternshipSchema = z.object({
  coverNote: z.string().trim().max(3000).optional(),
  resumeId: z.string().cuid().optional(),
  consentToShare: z.literal(true, { errorMap: () => ({ message: 'Consent is required to share your application with this organisation.' }) }),
});
