import { z } from 'zod';

const optionalUrl = z.string().trim().url().max(500).optional().or(z.literal(''));

export const resumeContentSchema = z.object({
  headline: z.string().trim().max(160).optional(),
  summary: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(30).optional(),
  location: z.string().trim().max(120).optional(),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  education: z.array(z.object({
    institution: z.string().trim().min(2).max(160),
    degree: z.string().trim().max(120).optional(),
    year: z.string().trim().max(40).optional(),
    detail: z.string().trim().max(300).optional(),
  })).max(8).default([]),
  skills: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    level: z.string().trim().max(40).optional(),
  })).max(40).default([]),
  experience: z.array(z.object({
    role: z.string().trim().min(2).max(120),
    organization: z.string().trim().min(2).max(160),
    period: z.string().trim().max(80),
    bullets: z.array(z.string().trim().min(3).max(500)).max(8).default([]),
  })).max(12).default([]),
  projects: z.array(z.object({
    title: z.string().trim().min(2).max(160),
    tech: z.string().trim().max(200).optional(),
    bullets: z.array(z.string().trim().min(3).max(500)).max(8).default([]),
  })).max(12).default([]),
  certifications: z.array(z.object({
    title: z.string().trim().min(2).max(160),
    issuer: z.string().trim().min(2).max(160),
    date: z.string().trim().max(40),
    certificateId: z.string().trim().max(80).optional(),
  })).max(20).default([]),
  achievements: z.array(z.string().trim().min(2).max(300)).max(20).default([]),
});

export const createResumeSchema = z.object({
  title: z.string().trim().min(2).max(120).default('My Resume'),
  templateId: z.enum(['classic', 'modern', 'minimal', 'academic']).default('classic'),
  content: resumeContentSchema,
  isPrimary: z.boolean().optional().default(false),
});

export const updateResumeSchema = createResumeSchema.partial();
export type ResumeContent = z.infer<typeof resumeContentSchema>;
export type CreateResumeInput = z.infer<typeof createResumeSchema>;
