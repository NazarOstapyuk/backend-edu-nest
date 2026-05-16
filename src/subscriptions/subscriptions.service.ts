import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, SubscriptionStatus } from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSubscriptionDto) {
    const type = await this.prisma.subscriptionType.findUnique({ where: { id: dto.subscriptionTypeId } });
    if (!type) throw new NotFoundException('Subscription type not found');

    const children = await this.prisma.child.findMany({ where: { id: { in: dto.childIds } } });
    const foundIds = children.map((c) => c.id);
    const notFound = dto.childIds.filter((id) => !foundIds.includes(id));
    if (notFound.length) throw new NotFoundException(`Children not found: ${notFound.join(', ')}`);

    const pricePerSession = Number(type.pricePerSession);
    const totalPrice = pricePerSession * dto.totalSessions;

    const created = await Promise.all(
      dto.childIds.map((childId) =>
        this.prisma.subscription.create({
          data: {
            childId,
            subscriptionTypeId: dto.subscriptionTypeId,
            totalSessions: dto.totalSessions,
            remainingSessions: dto.totalSessions,
            pricePerSession,
            totalPrice,
          },
          include: { child: true, subscriptionType: true },
        }),
      ),
    );

    return created;
  }

  async findAll(filters: { childId?: string; status?: SubscriptionStatus }) {
    return this.prisma.subscription.findMany({
      where: { childId: filters.childId, status: filters.status },
      include: { child: true, subscriptionType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        child: true,
        subscriptionType: true,
        attendances: { orderBy: { date: 'desc' } },
      },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async findByChild(childId: string, requestingUser: AuthenticatedUser) {
    if (requestingUser.role === Role.parent) {
      const child = await this.prisma.child.findFirst({
        where: { id: childId, parents: { some: { id: requestingUser.id } } },
      });
      if (!child) throw new ForbiddenException('Access denied');
    }

    return this.prisma.subscription.findMany({
      where: { childId },
      include: { subscriptionType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.active) {
      throw new BadRequestException('Only active subscriptions can be updated');
    }

    const sessionsUsed = sub.totalSessions - sub.remainingSessions;
    if (dto.totalSessions < sessionsUsed) {
      throw new BadRequestException(
        `Cannot set totalSessions to ${dto.totalSessions}: ${sessionsUsed} sessions already used`,
      );
    }

    const totalPrice = Number(sub.pricePerSession) * dto.totalSessions;
    const remainingSessions = dto.totalSessions - sessionsUsed;

    return this.prisma.subscription.update({
      where: { id },
      data: { totalSessions: dto.totalSessions, remainingSessions, totalPrice },
      include: { child: true, subscriptionType: true },
    });
  }

  async cancel(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.active) {
      throw new BadRequestException('Only active subscriptions can be cancelled');
    }
    return this.prisma.subscription.update({
      where: { id },
      data: { status: SubscriptionStatus.cancelled },
    });
  }

  async delete(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    await this.prisma.subscription.delete({ where: { id } });
    return { message: 'Subscription deleted' };
  }
}
