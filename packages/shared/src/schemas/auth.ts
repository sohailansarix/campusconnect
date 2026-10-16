import { z } from 'zod';
import { ROLES, SELF_SIGNUP_ROLES } from '../constants.js';

/**
 * Password policy: length over composition theatre, but still require a mix so
 * that a leaked hash is not trivially crackable. Enforced identically on the
 * web client (React Hook Form) and the API (Zod) via this one schema.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt truncates beyond 72 bytes
  .regex(/[a-zA-Z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number')
  .regex(/[^a-zA-Z0-9]/, 'Include at least one symbol');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(160);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Use lowercase letters, numbers and hyphens');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your full name')
  .max(120)
  .regex(/^[\p{L}\p{M}.'\- ]+$/u, 'Name contains unsupported characters');

/* -------------------------------------------------------------------------- */
/* Register / login                                                           */
/* -------------------------------------------------------------------------- */

export const registerSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema.optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[0-9\s-]{7,20}$/, 'Enter a valid phone number')
    .optional(),
  /** Self-service signup is limited to non-privileged roles. */
  role: z.enum(SELF_SIGNUP_ROLES).default('STUDENT'),
  collegeId: z.string().cuid({ message: 'Select your college' }),
  departmentId: z.string().cuid().optional(),
  graduationYear: z.coerce.number().int().min(2020).max(2040).optional(),
  /** Consent is required before we store any profile data. */
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to continue' }) }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(72),
  /** Extends refresh-token lifetime to 30 days instead of the session default. */
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token is required'),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
  /** Revoke every active session, not just this device. */
  allDevices: z.boolean().optional().default(false),
});

/* -------------------------------------------------------------------------- */
/* Password reset                                                             */
/* -------------------------------------------------------------------------- */

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'Reset token is required'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Choose a password you have not used before',
    path: ['newPassword'],
  });

/* -------------------------------------------------------------------------- */
/* Admin-initiated provisioning                                               */
/* -------------------------------------------------------------------------- */

/** Admins invite faculty, coordinators, trainers and employers. */
export const inviteUserSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  role: z.enum(ROLES).refine((r) => r !== 'STUDENT' && r !== 'SUPER_ADMIN', 'Use the student signup flow'),
  collegeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  companyName: z.string().trim().min(2).max(160).optional(),
  jobTitle: z.string().trim().max(120).optional(),
});

export const verifyEmailSchema = z.object({ token: z.string().min(20) });

export const AUTH_SCHEMAS = {
  register: registerSchema,
  login: loginSchema,
  refresh: refreshTokenSchema,
  logout: logoutSchema,
  forgotPassword: forgotPasswordSchema,
  resetPassword: resetPasswordSchema,
  changePassword: changePasswordSchema,
  invite: inviteUserSchema,
} as const;
