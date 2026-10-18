import { prisma } from '../config/prisma.js';

export async function hasPremiumAccess(userId: string): Promise<boolean> {
  return Boolean(await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ['ACTIVE', 'TRIALING'] },
      currentPeriodEnd: { gt: new Date() },
      deletedAt: null,
      plan: 'PREMIUM_STUDENT',
    },
    select: { id: true },
  }));
}
