import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type CashShift } from '@prisma/client';
import { kyivDayStart } from '../audit/audit-calc';
import { money } from '../finance/finance-calc';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, isoDay, toDay } from '../tariffs/dates';
import { CashAlertsService } from './cash-alerts.service';
import {
  countTotal,
  expectedBalance,
  needsExplanation,
  shiftTotals,
} from './cash-calc';
import {
  entryInclude,
  entryView,
  isUniqueViolation,
  shiftInclude,
  shiftView,
  totalsSelect,
  type CashEntryView,
  type CashShiftView,
} from './cash-views';
import type { CountDto } from './dto/count.dto';
import type { ShiftsQueryDto } from './dto/shifts-query.dto';

const MIN_NOTE = 5;

export interface CashShiftReport {
  shift: CashShiftView;
  entries: CashEntryView[];
}

const lockDesk = async (tx: Prisma.TransactionClient, deskId: string) => {
  await tx.$queryRaw`SELECT id FROM "CashDesk" WHERE id = ${deskId} FOR UPDATE`;
};

const requireNote = (
  expected: Prisma.Decimal,
  counted: Prisma.Decimal,
  note: string | undefined,
): string | null => {
  const trimmed = note?.trim() ?? '';
  if (needsExplanation(expected, counted) && trimmed.length < MIN_NOTE) {
    throw new BadRequestException('Explanation required');
  }
  return trimmed || null;
};

@Injectable()
export class CashShiftsService {
  constructor(
    private prisma: PrismaService,
    private alerts: CashAlertsService,
  ) {}

  async lockOpenShift(
    tx: Prisma.TransactionClient,
    deskId: string,
  ): Promise<CashShift> {
    await lockDesk(tx, deskId);
    const desk = await tx.cashDesk.findUnique({ where: { id: deskId } });
    if (!desk) throw new NotFoundException('Cash desk not found');
    const shift = await tx.cashShift.findFirst({
      where: { deskId, closedAt: null },
    });
    if (!shift) throw new BadRequestException('No open cash shift');
    return shift;
  }

  async balance(
    tx: Prisma.TransactionClient,
    shift: CashShift,
  ): Promise<Prisma.Decimal> {
    const entries = await tx.cashEntry.findMany({
      where: { shiftId: shift.id },
    });
    return expectedBalance(shift.openingCounted, shiftTotals(entries));
  }

  async open(
    deskId: string,
    dto: CountDto,
    userId: string,
  ): Promise<CashShiftReport> {
    const counted = countTotal(dto.denominations);
    try {
      const shift = await this.prisma.$transaction(async (tx) => {
        await lockDesk(tx, deskId);
        const desk = await tx.cashDesk.findUnique({ where: { id: deskId } });
        if (!desk) throw new NotFoundException('Cash desk not found');
        if (!desk.isActive) {
          throw new BadRequestException('Cash desk is inactive');
        }
        const open = await tx.cashShift.findFirst({
          where: { deskId, closedAt: null },
        });
        if (open) throw new BadRequestException('Shift already open');
        const last = await tx.cashShift.findFirst({
          where: { deskId, closedAt: { not: null } },
          orderBy: { closedAt: 'desc' },
        });
        const expected = money(last?.closingCounted ?? 0);
        const note = requireNote(expected, counted, dto.note);
        const created = await tx.cashShift.create({
          data: {
            deskId,
            openedById: userId,
            openingExpected: expected,
            openingCounted: counted,
            openingNote: note,
          },
        });
        if (needsExplanation(expected, counted)) {
          await this.alerts.create(tx, {
            deskId,
            shiftId: created.id,
            type: 'opening_discrepancy',
            amount: counted.sub(expected),
            actorId: userId,
          });
        }
        return created;
      });
      return await this.report(shift.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException('Shift already open');
      }
      throw error;
    }
  }

  async close(
    shiftId: string,
    dto: CountDto,
    userId: string,
  ): Promise<CashShiftReport> {
    const counted = countTotal(dto.denominations);
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.cashShift.findUnique({ where: { id: shiftId } });
      if (!found) throw new NotFoundException('Shift not found');
      await lockDesk(tx, found.deskId);
      const shift = await tx.cashShift.findUnique({ where: { id: shiftId } });
      if (!shift) throw new NotFoundException('Shift not found');
      if (shift.closedAt) throw new BadRequestException('Shift is closed');
      const entries = await tx.cashEntry.findMany({ where: { shiftId } });
      const totals = shiftTotals(entries);
      const expected = expectedBalance(shift.openingCounted, totals);
      const note = requireNote(expected, counted, dto.note);
      await tx.cashShift.update({
        where: { id: shiftId },
        data: {
          closedAt: new Date(),
          closedById: userId,
          closingExpected: expected,
          closingCounted: counted,
          denominations: dto.denominations,
          closingNote: note,
          totals: totals as unknown as Prisma.InputJsonValue,
        },
      });
      await this.alerts.create(tx, {
        deskId: shift.deskId,
        shiftId,
        type: 'shift_closed',
        amount: counted,
        actorId: userId,
      });
      if (needsExplanation(expected, counted)) {
        await this.alerts.create(tx, {
          deskId: shift.deskId,
          shiftId,
          type: 'discrepancy',
          amount: counted.sub(expected),
          actorId: userId,
        });
      }
    });
    return this.report(shiftId);
  }

  async list(query: ShiftsQueryDto): Promise<CashShiftView[]> {
    const where: Prisma.CashShiftWhereInput = {};
    if (query.deskId) where.deskId = query.deskId;
    if (query.userId) {
      where.OR = [{ openedById: query.userId }, { closedById: query.userId }];
    }
    if (query.from || query.to) {
      where.openedAt = {
        ...(query.from && { gte: kyivDayStart(query.from) }),
        ...(query.to && {
          lt: kyivDayStart(isoDay(addDays(toDay(query.to), 1))),
        }),
      };
    }
    const shifts = await this.prisma.cashShift.findMany({
      where,
      include: shiftInclude,
      orderBy: { openedAt: 'desc' },
    });
    const openIds = shifts
      .filter((shift) => shift.closedAt === null)
      .map((shift) => shift.id);
    const entries = openIds.length
      ? await this.prisma.cashEntry.findMany({
          where: { shiftId: { in: openIds } },
          select: { shiftId: true, ...totalsSelect },
        })
      : [];
    return shifts.map((shift) =>
      shiftView(
        shift,
        entries.filter((entry) => entry.shiftId === shift.id),
      ),
    );
  }

  async report(id: string): Promise<CashShiftReport> {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id },
      include: {
        ...shiftInclude,
        entries: { include: entryInclude, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    return {
      shift: shiftView(shift, shift.entries),
      entries: shift.entries.map(entryView),
    };
  }
}
