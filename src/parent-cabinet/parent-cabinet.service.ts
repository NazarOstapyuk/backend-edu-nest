import { Injectable, NotFoundException } from '@nestjs/common';
import { AdjustmentType, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  activeAllocated,
  chargeRemaining,
  chargeState,
  formatMoney,
  paymentFree,
  sumMoney,
} from '../finance/finance-calc';
import {
  effectiveExpiry,
  packageRemaining,
  packageState,
} from '../classes/consumption';
import { kyivToday } from '../tariffs/dates';
import { childMoney, isOverdue } from './cabinet-calc';

const moneyCharge = {
  select: {
    id: true,
    description: true,
    category: true,
    amount: true,
    periodStart: true,
    periodEnd: true,
    createdAt: true,
    voidedAt: true,
    allocations: { select: { amount: true, voidedAt: true } },
  },
} as const;

const moneyPayment = {
  select: {
    amount: true,
    category: true,
    status: true,
    voidedAt: true,
    allocations: { select: { amount: true, voidedAt: true } },
  },
} as const;

const visitOrder = { adaptation: 0, lesson: 1, legacy: 2 } as const;

@Injectable()
export class ParentCabinetService {
  constructor(private prisma: PrismaService) {}

  private async assertOwnChild(parentId: string, childId: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, parents: { some: { id: parentId } } },
      select: { id: true },
    });
    if (!child) throw new NotFoundException('Child not found');
  }

  async family(parentId: string, today: Date = kyivToday()) {
    const children = await this.prisma.child.findMany({
      where: { parents: { some: { id: parentId } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        group: { select: { id: true, name: true } },
        charges: moneyCharge,
        payments: moneyPayment,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const rows = children.map((c) => {
      const money = childMoney(c.charges, c.payments, today);
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        middleName: c.middleName,
        group: c.group,
        due: money.due,
        overdue: money.overdue,
        prepayment: money.prepayment,
      };
    });
    const total = (key: 'due' | 'overdue' | 'prepayment') =>
      formatMoney(sumMoney(rows.map((r) => r[key])));
    return {
      children: rows,
      totals: {
        due: total('due'),
        overdue: total('overdue'),
        prepayment: total('prepayment'),
      },
    };
  }

  async card(parentId: string, childId: string, today: Date = kyivToday()) {
    await this.assertOwnChild(parentId, childId);
    const child = await this.prisma.child.findFirst({
      where: { id: childId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        birthDate: true,
        group: { select: { id: true, name: true } },
        parents: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            middleName: true,
            phone: true,
            email: true,
          },
          orderBy: { lastName: 'asc' },
        },
        enrollments: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            tariff: { select: { name: true } },
            adjustments: {
              where: { type: AdjustmentType.pause, voidedAt: null },
              select: { startDate: true, endDate: true },
              orderBy: { startDate: 'asc' },
            },
          },
          orderBy: { startDate: 'desc' },
        },
        packages: {
          where: { voidedAt: null },
          include: {
            direction: { select: { name: true } },
            extensions: { select: { newExpiresAt: true, createdAt: true } },
            usages: { select: { voidedAt: true } },
          },
          orderBy: { purchaseDate: 'desc' },
        },
        lessonAttendances: {
          where: { voidedAt: null },
          select: {
            status: true,
            isGuest: true,
            lesson: {
              select: {
                date: true,
                classGroup: {
                  select: {
                    name: true,
                    direction: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        adaptationVisits: {
          where: { voidedAt: null },
          select: { date: true, hours: true },
        },
        subscriptions: {
          select: {
            subscriptionType: { select: { name: true } },
            attendances: { select: { date: true, note: true } },
          },
        },
      },
    });
    if (!child) throw new NotFoundException('Child not found');

    const visits = [
      ...child.lessonAttendances.map((a) => ({
        type: 'lesson' as const,
        date: a.lesson.date,
        groupName: a.lesson.classGroup.name,
        directionName: a.lesson.classGroup.direction.name,
        status: a.status,
        isGuest: a.isGuest,
      })),
      ...child.adaptationVisits.map((v) => ({
        type: 'adaptation' as const,
        date: v.date,
        hours: formatMoney(v.hours),
      })),
      ...child.subscriptions.flatMap((s) =>
        s.attendances.map((a) => ({
          type: 'legacy' as const,
          date: kyivToday(a.date),
          note: a.note,
          directionName: s.subscriptionType.name,
        })),
      ),
    ].sort(
      (a, b) =>
        b.date.getTime() - a.date.getTime() ||
        visitOrder[a.type] - visitOrder[b.type],
    );

    return {
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      middleName: child.middleName,
      birthDate: child.birthDate,
      group: child.group,
      parents: child.parents,
      enrollments: child.enrollments.map((e) => ({
        id: e.id,
        tariffName: e.tariff.name,
        startDate: e.startDate,
        endDate: e.endDate,
        pauses: e.adjustments,
      })),
      packages: child.packages.map((p) => {
        const remaining = packageRemaining(p);
        return {
          id: p.id,
          directionName: p.direction.name,
          sessionsTotal: p.sessionsTotal,
          used: p.sessionsTotal - remaining,
          remaining,
          expiresAt: effectiveExpiry(p),
          state: packageState(p, today),
        };
      }),
      visits,
    };
  }

  async finance(parentId: string, childId: string, today: Date = kyivToday()) {
    await this.assertOwnChild(parentId, childId);
    const [charges, payments] = await Promise.all([
      this.prisma.charge.findMany({
        where: { childId, voidedAt: null },
        select: {
          id: true,
          category: true,
          description: true,
          amount: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          voidedAt: true,
          allocations: { select: { amount: true, voidedAt: true } },
        },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.payment.findMany({
        where: { childId, voidedAt: null, status: PaymentStatus.confirmed },
        select: {
          id: true,
          amount: true,
          category: true,
          method: true,
          status: true,
          receivedAt: true,
          voidedAt: true,
          allocations: {
            select: {
              amount: true,
              voidedAt: true,
              chargeId: true,
              charge: { select: { description: true } },
            },
          },
        },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);
    const money = childMoney(charges, payments, today);
    return {
      summary: money.categories,
      unallocated: money.unallocated,
      charges: charges.map((c) => {
        const paid = activeAllocated(c.allocations);
        return {
          id: c.id,
          category: c.category,
          description: c.description,
          periodStart: c.periodStart,
          periodEnd: c.periodEnd,
          amount: formatMoney(c.amount),
          paid: formatMoney(paid),
          remaining: formatMoney(chargeRemaining(c)),
          state: chargeState(c.amount, paid),
          overdue: isOverdue(c, today),
          createdAt: c.createdAt,
        };
      }),
      payments: payments.map((p) => ({
        id: p.id,
        receivedAt: p.receivedAt,
        amount: formatMoney(p.amount),
        method: p.method,
        category: p.category,
        allocated: formatMoney(activeAllocated(p.allocations)),
        free: formatMoney(paymentFree(p)),
        allocations: p.allocations
          .filter((a) => !a.voidedAt)
          .map((a) => ({
            chargeId: a.chargeId,
            description: a.charge.description,
            amount: formatMoney(a.amount),
          })),
      })),
    };
  }
}
