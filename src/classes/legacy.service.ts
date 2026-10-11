import { Injectable } from '@nestjs/common';
import { MissedLessonRule, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toDay } from '../tariffs/dates';

@Injectable()
export class LegacyService {
  constructor(private prisma: PrismaService) {}

  async migrate(userId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      include: { subscriptionType: true, package: { select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const directionIds = new Map<string, string>();
    let directions = 0;
    let packages = 0;
    let skipped = 0;

    for (const sub of subscriptions) {
      if (sub.package) {
        skipped += 1;
        continue;
      }
      const name = sub.subscriptionType.name;
      let directionId = directionIds.get(name);
      if (!directionId) {
        const existing = await this.prisma.direction.findUnique({
          where: { name },
        });
        if (existing) {
          directionId = existing.id;
        } else {
          const created = await this.prisma.direction.create({
            data: { name, missedRule: MissedLessonRule.no_charge },
          });
          directionId = created.id;
          directions += 1;
        }
        directionIds.set(name, directionId);
      }

      const cancelled = sub.status === SubscriptionStatus.cancelled;
      await this.prisma.package.create({
        data: {
          childId: sub.childId,
          directionId,
          tariffId: null,
          sessionsTotal: sub.totalSessions,
          usedBefore: sub.totalSessions - sub.remainingSessions,
          purchaseDate: toDay(sub.createdAt),
          expiresAt: null,
          legacySubscriptionId: sub.id,
          needsReconciliation: !cancelled,
          createdById: userId,
          voidedAt: cancelled ? new Date() : null,
          voidedById: cancelled ? userId : null,
          voidReason: cancelled ? 'Скасовано до перенесення' : null,
        },
      });
      packages += 1;
    }

    return { directions, packages, skipped };
  }
}
