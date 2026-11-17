import { Injectable, NotFoundException } from '@nestjs/common';
import type { CashAlertType, Prisma } from '@prisma/client';
import { formatMoney } from '../finance/finance-calc';
import { PrismaService } from '../prisma/prisma.service';
import { isUnclosed } from './cash-calc';
import { person, personSelect, type Person } from './cash-views';

export interface CashAlertData {
  deskId: string;
  shiftId?: string;
  entryId?: string;
  type: CashAlertType;
  amount?: string | Prisma.Decimal;
  actorId?: string;
}

export interface CashAlertView {
  id: string;
  type: CashAlertType;
  deskId: string;
  deskName: string;
  shiftId: string | null;
  entryId: string | null;
  amount: string | null;
  actor: Person | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export interface UnclosedShiftView {
  deskId: string;
  deskName: string;
  shiftId: string;
  openedAt: Date;
  openedBy: Person;
}

const ALERTS_LIMIT = 200;

@Injectable()
export class CashAlertsService {
  constructor(private prisma: PrismaService) {}

  create(tx: Prisma.TransactionClient, data: CashAlertData) {
    return tx.cashAlert.create({ data });
  }

  async list(all: boolean): Promise<CashAlertView[]> {
    const alerts = await this.prisma.cashAlert.findMany({
      where: all ? {} : { acknowledgedAt: null },
      include: { desk: { select: { name: true } }, actor: personSelect },
      orderBy: { createdAt: 'desc' },
      take: ALERTS_LIMIT,
    });
    return alerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      deskId: alert.deskId,
      deskName: alert.desk.name,
      shiftId: alert.shiftId,
      entryId: alert.entryId,
      amount: alert.amount ? formatMoney(alert.amount) : null,
      actor: alert.actor ? person(alert.actor) : null,
      createdAt: alert.createdAt,
      acknowledgedAt: alert.acknowledgedAt,
    }));
  }

  async unclosed(): Promise<UnclosedShiftView[]> {
    const shifts = await this.prisma.cashShift.findMany({
      where: { closedAt: null, desk: { isActive: true } },
      include: {
        desk: { select: { name: true, closeBy: true } },
        openedBy: personSelect,
      },
      orderBy: { openedAt: 'asc' },
    });
    const now = new Date();
    return shifts
      .filter((shift) => isUnclosed(shift.openedAt, shift.desk.closeBy, now))
      .map((shift) => ({
        deskId: shift.deskId,
        deskName: shift.desk.name,
        shiftId: shift.id,
        openedAt: shift.openedAt,
        openedBy: person(shift.openedBy),
      }));
  }

  async count(): Promise<{ count: number }> {
    const [alerts, unclosed] = await Promise.all([
      this.prisma.cashAlert.count({ where: { acknowledgedAt: null } }),
      this.unclosed(),
    ]);
    return { count: alerts + unclosed.length };
  }

  async ack(id: string, userId: string): Promise<{ updated: number }> {
    const alert = await this.prisma.cashAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.acknowledgedAt) return { updated: 0 };
    const result = await this.prisma.cashAlert.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId },
    });
    return { updated: result.count };
  }

  async ackAll(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.cashAlert.updateMany({
      where: { acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId },
    });
    return { updated: result.count };
  }
}
