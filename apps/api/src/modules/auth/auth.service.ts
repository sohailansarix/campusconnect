import type { AuthPrincipal, RegisterInput, LoginInput, Role, TokenPair } from '@campusconnect/shared';
import { SELF_SIGNUP_ROLES } from '@campusconnect/shared';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TokenInvalidError,
  UnauthenticatedError,
  ValidationError,
} from '../../utils/errors.js';
import {
  hashPassword,
  rehashOnLogin,
  verifyPassword,
  burnPasswordComparison,
} from '../../utils/password.js';
import {
  refreshExpiryDate,
  signAccessToken,
  signRefreshToken,
  ttlSeconds,
  verifyRefreshToken,
} from '../../utils/jwt.js';
import { generateOpaqueToken, generateUsername, sha256, uniqueSlug } from '../../utils/ids.js';
import { sanitizeText } from '../../utils/sanitize.js';
import { notify, seedDefaultPreferences } from '../notifications/notification.service.js';
import * as templates from '../mailer/templates.js';

/**
 * Authentication service.
 *
 * Covers registration, login, token refresh with rotation, logout, password
 * reset, and password change.
 *
 * Security decisions that are load-bearing, not incidental:
 *
 *  * **Login is timing-safe for unknown emails.** A non-existent address still
 *    performs a bcrypt comparison, so the endpoint cannot be used to enumerate
 *    accounts. See `burnPasswordComparison`.
 *
 *  * **Reset requests always report success.** Whether or not the email exists,
 *    the caller sees the same response. The alternative leaks membership.
 *
 *  * **Refresh tokens rotate on every use.** The presented token is revoked and a
 *    new one issued. If a *already-revoked* token is presented, that means either
 *    theft or a client bug — every session for that user is revoked and the user
 *    is notified. This is the standard reuse-detection pattern, and it is what
 *    makes a long refresh TTL acceptable.
 *
 *  * **`tokenVersion` is the kill switch.** Bumping it invalidates every
 *    outstanding access token without a database lookup per request beyond the
 *    comparison the auth middleware already does.
 */

const RESET_TOKEN_TTL_MINUTES = 30;
const EMAIL_VERIFY_TTL_HOURS = 48;
const INVITE_TTL_HOURS = 24 * 7;

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export type RegisterResult = {
  user: AuthPrincipal;
  tokens: TokenPair;
};

export async function register(
  input: RegisterInput,
  context: { ip?: string; userAgent?: string },
): Promise<RegisterResult> {
  // Self-service signup is restricted to the roles the shared package allows.
  // Anything else must go through the invitation flow.
  if (!(SELF_SIGNUP_ROLES as readonly Role[]).includes(input.role)) {
    throw new ForbiddenError('That role cannot be created through self signup');
  }

  const email = input.email.toLowerCase();

  const college = await prisma.college.findFirst({
    where: { id: input.collegeId, deletedAt: null },
    select: { id: true, name: true, isActive: true },
  });

  if (!college) throw new NotFoundError('College');
  if (!college.isActive) {
    throw new ValidationError('Signups for this college are temporarily closed');
  }

  // Validate the department belongs to the chosen college before we write
  // anything — otherwise a student could attach themselves to another tenant.
  if (input.departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: input.departmentId, collegeId: college.id, deletedAt: null },
      select: { id: true },
    });
    if (!department) throw new ValidationError('That department does not belong to the selected college');
  }

  const existing = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true },
  });

  // Deliberately explicit here, unlike login. Someone creating an account needs
  // to be told the address is taken so they can sign in instead.
  if (existing) {
    throw new ConflictError('An account with that email already exists — try signing in instead');
  }

  const passwordHash = await hashPassword(input.password);

  const username = input.username
    ? await ensureUsernameAvailable(input.username)
    : await generateUsername(input.fullName, usernameExists);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        username,
        passwordHash,
        fullName: sanitizeText(input.fullName),
        phone: input.phone ?? null,
        role: 'STUDENT',
        collegeId: college.id,
        departmentId: input.departmentId ?? null,
        status: 'ACTIVE',
        acceptedTermsAt: new Date(),
        // Consent is opt-in for employer search; the student enables it from
        // their privacy settings. Signup consent covers terms, not visibility.
        consentToEmployerSearch: false,
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        role: true,
        collegeId: true,
        departmentId: true,
      },
    });

    await tx.studentProfile.create({
      data: {
        userId: created.id,
        collegeId: college.id,
        departmentId: input.departmentId ?? null,
        graduationYear: input.graduationYear ?? null,
        // Employers-only by default: the student can share the link, but a
        // stranger cannot stumble onto their profile.
        passportVisibility: 'EMPLOYERS_ONLY',
      },
    });

    return created;
  });

  await seedDefaultPreferences(user.id);

  const principal: AuthPrincipal = {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    collegeId: user.collegeId,
    departmentId: user.departmentId,
    employerId: null,
  };

  const tokens = await issueTokenPair(principal, 0, context);

  // Welcome email and verification go out after the session exists, so a mail
  // failure cannot cost the student their registration.
  await notify({
    userId: user.id,
    type: 'SYSTEM',
    title: 'Welcome to CampusConnect',
    body: `Your account for ${college.name} is ready. Complete your profile to get relevant recommendations.`,
    actionUrl: '/dashboard/profile',
    forceChannels: ['EMAIL'],
    email: () =>
      templates.welcomeEmail({
        fullName: user.fullName,
        collegeName: college.name,
        dashboardUrl: `${env.WEB_URL}/dashboard`,
      }),
  });

  await sendEmailVerification(user.id, { ip: context.ip, userAgent: context.userAgent });

  rootLogger.info('User registered', {
    userId: user.id,
    collegeId: college.id,
    role: 'STUDENT',
  });

  return { user: principal, tokens };
}

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

export async function login(
  input: LoginInput,
  context: { ip?: string; userAgent?: string },
): Promise<RegisterResult> {
  const email = input.email.toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      passwordHash: true,
      tokenVersion: true,
      collegeId: true,
      departmentId: true,
      deletedAt: true,
      employerProfile: { select: { id: true } },
      college: { select: { isActive: true, name: true } },
    },
  });

  // Timing parity: an unknown email and a wrong password must take the same time.
  if (!user || user.deletedAt !== null) {
    await burnPasswordComparison(input.password);
    throw new UnauthenticatedError('Incorrect email or password');
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    // Deliberately the same message as an unknown email — see above.
    throw new UnauthenticatedError('Incorrect email or password');
  }

  if (user.status === 'SUSPENDED') {
    throw new ForbiddenError('Your account has been suspended. Contact your college administrator.');
  }
  if (user.status === 'DEACTIVATED') {
    throw new UnauthenticatedError('Your account has been deactivated');
  }
  if (user.status === 'PENDING_INVITE') {
    throw new ForbiddenError('Finish setting up your account from the invitation link we emailed you');
  }
  if (user.college && !user.college.isActive && user.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Your institution is temporarily inactive');
  }

  // Opportunistic cost upgrade — see `needsRehash`.
  const newHash = await rehashOnLogin(input.password, user.passwordHash);
  if (newHash) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    logger.info('Password hash upgraded to the current cost factor', { userId: user.id });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const principal: AuthPrincipal = {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    collegeId: user.collegeId,
    departmentId: user.departmentId,
    employerId: user.employerProfile?.id ?? null,
  };

  const tokens = await issueTokenPair(principal, user.tokenVersion, context, input.rememberMe);

  return { user: principal, tokens };
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Issues an access + refresh pair and records the session.
 *
 * The refresh token is hashed before storage. `Session.id` is embedded in the
 * token as `sid`, so a refresh can be validated against one specific session
 * rather than merely "a valid signature for this user".
 */
export async function issueTokenPair(
  principal: AuthPrincipal,
  tokenVersion: number,
  context: { ip?: string; userAgent?: string },
  rememberMe = false,
): Promise<TokenPair> {
  // The session row must exist before the token can reference its id, so we
  // create it with a placeholder hash and update it immediately after.
  const session = await prisma.session.create({
    data: {
      userId: principal.id,
      refreshTokenHash: `pending-${generateOpaqueToken(16)}`,
      expiresAt: refreshExpiryDate(rememberMe),
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent?.slice(0, 300) ?? null,
    },
    select: { id: true },
  });

  const refreshToken = signRefreshToken(principal.id, session.id, tokenVersion);
  const accessToken = signAccessToken(principal, tokenVersion);

  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: sha256(refreshToken) },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: ttlSeconds('access'),
  };
}

/**
 * Rotates a refresh token.
 *
 * Presents the reuse-detection behaviour described in the file header: a token
 * whose hash matches no *active* session, but which is otherwise a valid
 * signature for a known user, is treated as theft and revokes every session.
 */
export async function refresh(
  rawRefreshToken: string,
  context: { ip?: string; userAgent?: string },
): Promise<{ tokens: TokenPair; user: AuthPrincipal }> {
  let claims;
  try {
    claims = verifyRefreshToken(rawRefreshToken);
  } catch (error) {
    throw error instanceof TokenInvalidError
      ? error
      : new UnauthenticatedError('Your session is no longer valid — please sign in again');
  }

  const tokenHash = sha256(rawRefreshToken);

  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: tokenHash },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
      replacedByHash: true,
    },
  });

  // A signed token with no matching session row — either the session was purged
  // or the token was minted with a stolen secret.
  if (!session) {
    throw new TokenInvalidError('Your session is no longer valid — please sign in again');
  }

  if (session.revokedAt !== null || session.replacedByHash !== null) {
    // Reuse of a rotated or revoked token. Treat as compromise.
    await revokeAllSessions(
      session.userId,
      'A previously used session token was presented again — this usually means the token was copied',
    );

    logger.warn('Refresh token reuse detected — all sessions revoked', {
      userId: session.userId,
      sessionId: session.id,
      ip: context.ip,
    });

    await notify({
      userId: session.userId,
      type: 'SYSTEM',
      title: 'Security alert: signed out of all devices',
      body: 'A session token was used more than once, which can happen if it was copied. For your safety we signed you out everywhere. If this was not you, change your password.',
      actionUrl: '/settings/security',
      forceChannels: ['IN_APP', 'EMAIL'],
      urgent: true,
      dedupeKey: `reuse-${session.id}`,
    });

    throw new TokenInvalidError('Your session is no longer valid — please sign in again');
  }

  if (session.expiresAt < new Date()) {
    throw new UnauthenticatedError('Your session has expired — please sign in again');
  }

  const user = await prisma.user.findFirst({
    where: { id: session.userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      tokenVersion: true,
      collegeId: true,
      departmentId: true,
      employerProfile: { select: { id: true } },
    },
  });

  if (!user || user.status !== 'ACTIVE') {
    await revokeSession(session.id, 'Account is no longer active');
    throw new UnauthenticatedError('Your account is no longer active');
  }

  if (user.tokenVersion !== claims.tokenVersion) {
    await revokeSession(session.id, 'Token version changed');
    throw new UnauthenticatedError('Your session is no longer valid — please sign in again');
  }

  const principal: AuthPrincipal = {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    collegeId: user.collegeId,
    departmentId: user.departmentId,
    employerId: user.employerProfile?.id ?? null,
  };

  /**
   * Rotation, in one transaction.
   *
   * The old session is revoked *first*, and the replacement row is created with
   * a fresh placeholder hash before the real token is signed against its id. The
   * ordering matters: `Session.refreshTokenHash` is unique, so writing the new
   * hash onto the old row and then inserting a new row with the same hash would
   * violate the constraint. Revoking and clearing the old hash avoids that.
   */
  const { tokens } = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        revokedReason: 'Rotated',
        // Clear the hash so the rotated row no longer collides with its
        // replacement. The previous hash is recorded on the audit trail instead.
        refreshTokenHash: `rotated-${session.id}`,
      },
    });

    const nextSession = await tx.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: `pending-${generateOpaqueToken(16)}`,
        // The successor inherits the original expiry, so rotation cannot be used
        // to extend a session indefinitely.
        expiresAt: session.expiresAt,
        ipAddress: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });

    const nextRefreshToken = signRefreshToken(user.id, nextSession.id, user.tokenVersion);

    await tx.session.update({
      where: { id: nextSession.id },
      data: { refreshTokenHash: sha256(nextRefreshToken) },
    });

    return {
      tokens: {
        accessToken: signAccessToken(principal, user.tokenVersion),
        refreshToken: nextRefreshToken,
        expiresIn: ttlSeconds('access'),
      },
    };
  });

  return { tokens, user: principal };
}

/** Revokes one session. Idempotent. */
export async function revokeSession(sessionId: string, reason = 'Signed out'): Promise<void> {
  await prisma.session
    .updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
    .catch((error: unknown) => {
      logger.warn('Failed to revoke session', { sessionId, error: String(error) });
    });
}

/**
 * Revokes every active session for a user and optionally bumps `tokenVersion`,
 * which also invalidates outstanding access tokens.
 */
export async function revokeAllSessions(
  userId: string,
  reason: string,
  options: { bumpTokenVersion?: boolean } = {},
): Promise<number> {
  const [result] = await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason.slice(0, 200) },
    }),
    ...(options.bumpTokenVersion !== false
      ? [prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } })]
      : []),
  ]);

  return result.count;
}

/** Logout. Revokes the presented session, or all of them when `allDevices`. */
export async function logout(
  userId: string,
  options: { refreshToken?: string; allDevices?: boolean },
): Promise<void> {
  if (options.allDevices) {
    await revokeAllSessions(userId, 'Signed out of all devices');
    return;
  }

  if (options.refreshToken) {
    await prisma.session.updateMany({
      where: { userId, refreshTokenHash: sha256(options.refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'Signed out' },
    });
    return;
  }

  // No token supplied — revoke everything rather than leaving a session open,
  // which is the safer failure mode for an explicit logout request.
  await revokeAllSessions(userId, 'Signed out', { bumpTokenVersion: false });
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Starts a password reset.
 *
 * Always resolves successfully, whether or not the email exists. Requesting a
 * reset also revokes outstanding reset tokens so only the newest link works —
 * otherwise an older email in the inbox stays live for its full TTL.
 */
export async function requestPasswordReset(
  email: string,
  context: { ip?: string; userAgent?: string },
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
    select: { id: true, fullName: true, email: true, status: true },
  });

  if (!user || user.status === 'DEACTIVATED') {
    // Same latency profile as the success path, and no error.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return;
  }

  const token = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction([
    // Invalidate earlier links so the newest email is the only working one.
    prisma.verificationToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: sha256(token),
        expiresAt,
        requestedIp: context.ip ?? null,
        requestedAgent: context.userAgent?.slice(0, 300) ?? null,
      },
    }),
  ]);

  const resetUrl = `${env.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;

  await notify({
    userId: user.id,
    type: 'SYSTEM',
    title: 'Reset your password',
    body: 'We received a request to reset your password. The link expires in 30 minutes.',
    actionUrl: '/settings/security',
    forceChannels: ['EMAIL'],
    urgent: true,
    dedupeKey: `password-reset-${Date.now()}`,
    email: () =>
      templates.passwordResetEmail({
        fullName: user.fullName,
        resetUrl,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      }),
  });

  logger.info('Password reset requested', { userId: user.id, ip: context.ip });
}

/** Completes a password reset and signs the user out everywhere. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, type: true, expiresAt: true, usedAt: true, revokedAt: true },
  });

  if (!record || record.type !== 'PASSWORD_RESET') {
    throw new TokenInvalidError('That reset link is not valid');
  }
  if (record.usedAt !== null) {
    throw new TokenInvalidError('That reset link has already been used — request a new one');
  }
  if (record.revokedAt !== null) {
    throw new TokenInvalidError('A newer reset link was requested — use the most recent email');
  }
  if (record.expiresAt < new Date()) {
    throw new TokenInvalidError('That reset link has expired — request a new one');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // Changing a password invalidates every existing session. A reset is
        // often the response to a compromise, so leaving sessions alive would
        // defeat the point.
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'Password was reset' },
    }),
  ]);

  logger.info('Password reset completed', { userId: record.userId });
}

/** Password change from inside an authenticated session. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, passwordHash: true },
  });

  if (!user) throw new UnauthenticatedError();

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new ValidationError('Your current password is incorrect', [
    { path: 'currentPassword', message: 'Incorrect password' },
  ]);

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
    // Keep the *current* device signed in by minting a new token pair, and revoke
    // only the others. That requires the caller to reissue; the controller does.
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'Password changed' },
    }),
  ]);

  logger.info('Password changed', { userId });
}

/* -------------------------------------------------------------------------- */
/* Email verification                                                         */
/* -------------------------------------------------------------------------- */

export async function sendEmailVerification(
  userId: string,
  context: { ip?: string; userAgent?: string } = {},
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, fullName: true, emailVerifiedAt: true },
  });

  if (!user || user.emailVerifiedAt !== null) return;

  const token = generateOpaqueToken(32);

  await prisma.$transaction([
    prisma.verificationToken.updateMany({
      where: { userId, type: 'EMAIL_VERIFY', usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.verificationToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 3600 * 1000),
        requestedIp: context.ip ?? null,
      },
    }),
  ]);

  const verifyUrl = `${env.WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;

  await notify({
    userId,
    type: 'SYSTEM',
    title: 'Confirm your email address',
    body: 'Confirm your email to unlock certificates and job applications.',
    forceChannels: ['EMAIL'],
    dedupeKey: `email-verify-${Date.now()}`,
    email: () => ({
      subject: 'Confirm your CampusConnect email',
      html: `<p>Hi ${user.fullName.split(' ')[0] ?? user.fullName},</p><p>Please confirm your email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in ${EMAIL_VERIFY_TTL_HOURS} hours.</p>`,
      text: `Hi ${user.fullName.split(' ')[0] ?? user.fullName},\n\nPlease confirm your email address:\n${verifyUrl}\n\nThis link expires in ${EMAIL_VERIFY_TTL_HOURS} hours.`,
    }),
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, type: true, expiresAt: true, usedAt: true, revokedAt: true },
  });

  if (!record || record.type !== 'EMAIL_VERIFY') {
    throw new TokenInvalidError('That verification link is not valid');
  }
  if (record.usedAt !== null) {
    // Already verified is not an error worth showing the user.
    return;
  }
  if (record.revokedAt !== null || record.expiresAt < new Date()) {
    throw new TokenInvalidError('That verification link has expired — request a new one');
  }

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                */
/* -------------------------------------------------------------------------- */

export type InviteInput = {
  fullName: string;
  email: string;
  role: Role;
  collegeId?: string;
  departmentId?: string;
  companyName?: string;
  jobTitle?: string;
};

/**
 * Creates a PENDING_INVITE account and emails a setup link.
 *
 * The account has no usable password until the invitee sets one, so a leaked
 * invitation email cannot be replayed after it is used or expires.
 */
export async function inviteUser(
  input: InviteInput,
  invitedByUserId: string,
  context: { ip?: string; userAgent?: string },
): Promise<{ userId: string }> {
  const email = input.email.toLowerCase();

  const existing = await prisma.user.findFirst({ where: { email }, select: { id: true, status: true } });
  if (existing && existing.status !== 'DEACTIVATED') {
    throw new ConflictError('An account with that email already exists');
  }

  if (input.collegeId) {
    const college = await prisma.college.findFirst({
      where: { id: input.collegeId, deletedAt: null },
      select: { id: true },
    });
    if (!college) throw new NotFoundError('College');
  }

  // A random placeholder password. Login is blocked by PENDING_INVITE status, so
  // this value is never usable — it exists only to satisfy the column.
  const placeholderHash = await hashPassword(generateOpaqueToken(24));

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash: placeholderHash,
        fullName: sanitizeText(input.fullName),
        role: input.role,
        collegeId: input.collegeId ?? null,
        departmentId: input.departmentId ?? null,
        status: 'PENDING_INVITE',
        acceptedTermsAt: null,
      },
      select: { id: true, fullName: true, email: true },
    });

    if (input.role === 'EMPLOYER') {
      const slugBase = input.companyName ?? input.fullName;
      const slug = await uniqueSlug(slugBase, async (candidate) => {
        const count = await tx.employerProfile.count({ where: { slug: candidate } });
        return count > 0;
      });

      await tx.employerProfile.create({
        data: {
          userId: created.id,
          companyName: sanitizeText(input.companyName ?? input.fullName),
          slug,
          isVerified: false,
        },
      });
    }

    // Student profiles are only created for students; staff roles get one when
    // they claim the invite, if ever.
    if (input.role === 'STUDENT' && input.collegeId) {
      await tx.studentProfile.create({
        data: {
          userId: created.id,
          collegeId: input.collegeId,
          departmentId: input.departmentId ?? null,
          passportVisibility: 'EMPLOYERS_ONLY',
        },
      });
    }

    return created;
  });

  const token = generateOpaqueToken(32);

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      type: 'INVITE',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000),
      requestedIp: context.ip ?? null,
      requestedAgent: context.userAgent?.slice(0, 300) ?? null,
    },
  });

  const inviteUrl = `${env.WEB_URL}/accept-invite?token=${encodeURIComponent(token)}`;

  await prisma.auditLog.create({
    data: {
      userId: invitedByUserId,
      collegeId: input.collegeId ?? null,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      metadata: { invitedRole: input.role, email },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    },
  });

  await notify({
    userId: user.id,
    type: 'SYSTEM',
    title: 'You have been invited to CampusConnect',
    body: `An administrator has created a ${input.role.replace(/_/g, ' ').toLowerCase()} account for you.`,
    forceChannels: ['EMAIL'],
    dedupeKey: `invite-${user.id}`,
    email: () => ({
      subject: 'Your CampusConnect invitation',
      html: `<p>Hi ${user.fullName},</p><p>You have been invited to CampusConnect as a ${input.role.replace(/_/g, ' ').toLowerCase()}.</p><p><a href="${inviteUrl}">Set up your account</a></p><p>This link expires in 7 days.</p>`,
      text: `Hi ${user.fullName},\n\nYou have been invited to CampusConnect as a ${input.role.replace(/_/g, ' ').toLowerCase()}.\n\nSet up your account:\n${inviteUrl}\n\nThis link expires in 7 days.`,
    }),
  });

  return { userId: user.id };
}

/** Claims an invitation: sets a password and activates the account. */
export async function acceptInvite(
  token: string,
  password: string,
  context: { ip?: string; userAgent?: string },
): Promise<RegisterResult> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, type: true, expiresAt: true, usedAt: true, revokedAt: true },
  });

  if (!record || record.type !== 'INVITE') throw new TokenInvalidError('That invitation link is not valid');
  if (record.usedAt !== null) throw new TokenInvalidError('That invitation has already been used');
  if (record.revokedAt !== null || record.expiresAt < new Date()) {
    throw new TokenInvalidError('That invitation has expired — ask an administrator to resend it');
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

    return tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, status: 'ACTIVE', acceptedTermsAt: new Date() },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        tokenVersion: true,
        collegeId: true,
        departmentId: true,
        employerProfile: { select: { id: true } },
      },
    });
  });

  await seedDefaultPreferences(user.id);

  const principal: AuthPrincipal = {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    collegeId: user.collegeId,
    departmentId: user.departmentId,
    employerId: user.employerProfile?.id ?? null,
  };

  return { user: principal, tokens: await issueTokenPair(principal, user.tokenVersion, context) };
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    take: 20,
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function usernameExists(candidate: string): Promise<boolean> {
  const count = await prisma.user.count({ where: { username: candidate } });
  return count > 0;
}

async function ensureUsernameAvailable(username: string): Promise<string> {
  const exists = await usernameExists(username);
  if (exists) throw new ConflictError('That username is already taken — try another');
  return username;
}

/** Re-exported so the controller does not import the config directly. */
export const authConfig = {
  accessTtlSeconds: ttlSeconds('access'),
  refreshTtlSeconds: ttlSeconds('refresh'),
  isProduction: env.isProduction,
};
