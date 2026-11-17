import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PermissionArea,
  PermissionLevel,
  Role,
  type CashDirection,
  type Prisma,
} from '@prisma/client';
import { hasPermission } from '../access/access-calc';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import type { VoidDto } from '../finance/dto/void.dto';
import { money } from '../finance/finance-calc';
import { PrismaService } from '../prisma/prisma.service';
import { CashAlertsService } from './cash-alerts.service';
import { CashShiftsService, lockDesk } from './cash-shifts.service';
import {
  entryInclude,
  entryView,
  person,
  personSelect,
  type CashEntryView,
  type Person,
} from './cash-views';
import type { CorrectionDto } from './dto/correction.dto';
import type { CreateEntryDto } from './dto/create-entry.dto';
import type { DisputeDto } from './dto/dispute.dto';

const STAFF_ROLES: Role[] = [Role.root, Role.admin, Role.teacher];
const DEFAULT_DIRECTION: CashDirection = 'shared';

const positiveAmount = (value: string): Prisma.Decimal => {
  const amount = money(value);
  if (amount.lte(0)) {
    throw new BadRequestException('Amount must be greater than 0');
  }
  return amount;
};

@Injectable()
export class CashEntriesService {
  constructor(
    private prisma: PrismaService,
    private shifts: CashShiftsService,
    private alerts: CashAlertsService,
  ) {}

  async create(
    deskId: string,
    dto: CreateEntryDto,
    userId: string,
  ): Promise<CashEntryView> {
    const amount = positiveAmount(dto.amount);
    const comment = dto.comment?.trim() || null;
    if (dto.kind === 'expense') {
      if (!dto.expenseCategory) {
        throw new BadRequestException('Expense category is required');
      }
      if (dto.expenseCategory === 'other' && !comment) {
        throw new BadRequestException('Comment is required');
      }
    } else {
      if (!dto.recipientId) {
        throw new BadRequestException('Recipient not found');
      }
      if (dto.recipientId === userId) {
        throw new BadRequestException('Cannot transfer to yourself');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.kind === 'transfer') {
        const recipient = await tx.user.findFirst({
          where: {
            id: dto.recipientId,
            isActive: true,
            role: { in: STAFF_ROLES },
          },
          select: { id: true },
        });
        if (!recipient) throw new BadRequestException('Recipient not found');
      }
      const shift = await this.shifts.lockOpenShift(tx, deskId);
      const balance = await this.shifts.balance(tx, shift);
      if (amount.gt(balance)) throw new BadRequestException('Not enough cash');
      const created = await tx.cashEntry.create({
        data: {
          deskId,
          shiftId: shift.id,
          kind: dto.kind,
          amount,
          direction: dto.direction ?? DEFAULT_DIRECTION,
          expenseCategory:
            dto.kind === 'expense' ? dto.expenseCategory : undefined,
          recipientId: dto.kind === 'transfer' ? dto.recipientId : undefined,
          transferStatus: dto.kind === 'transfer' ? 'pending' : undefined,
          comment,
          createdById: userId,
        },
        include: entryInclude,
      });
      const desk = await tx.cashDesk.findUnique({ where: { id: deskId } });
      if (desk && amount.gte(desk.largeAmount)) {
        await this.alerts.create(tx, {
          deskId,
          shiftId: shift.id,
          entryId: created.id,
          type: 'large_withdrawal',
          amount,
          actorId: userId,
        });
      }
      return entryView(created);
    });
  }

  async correct(
    deskId: string,
    dto: CorrectionDto,
    userId: string,
  ): Promise<CashEntryView> {
    const amount = positiveAmount(dto.amount);
    return this.prisma.$transaction(async (tx) => {
      const shift = await this.shifts.lockOpenShift(tx, deskId);
      if (dto.correctsId) {
        const target = await tx.cashEntry.findUnique({
          where: { id: dto.correctsId },
        });
        if (!target || target.deskId !== deskId) {
          throw new NotFoundException('Entry not found');
        }
      }
      if (dto.sign === -1) {
        const balance = await this.shifts.balance(tx, shift);
        if (amount.gt(balance)) {
          throw new BadRequestException('Not enough cash');
        }
      }
      const created = await tx.cashEntry.create({
        data: {
          deskId,
          shiftId: shift.id,
          kind: 'correction',
          amount,
          sign: dto.sign,
          direction: dto.direction ?? DEFAULT_DIRECTION,
          comment: dto.comment.trim(),
          correctsId: dto.correctsId,
          createdById: userId,
        },
        include: entryInclude,
      });
      await this.alerts.create(tx, {
        deskId,
        shiftId: shift.id,
        entryId: created.id,
        type: 'correction',
        amount: amount.mul(dto.sign),
        actorId: userId,
      });
      return entryView(created);
    });
  }

  voidEntry(id: string, dto: VoidDto, userId: string): Promise<CashEntryView> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.cashEntry.findUnique({ where: { id } });
      if (!found) throw new NotFoundException('Entry not found');
      await lockDesk(tx, found.deskId);
      const entry = await tx.cashEntry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundException('Entry not found');
      if (entry.voidedAt) throw new BadRequestException('Entry is voided');
      const shift = await tx.cashShift.findUnique({
        where: { id: entry.shiftId },
      });
      if (!shift || shift.closedAt) {
        throw new BadRequestException('Shift is closed');
      }
      if (entry.kind === 'income') {
        throw new BadRequestException('Income is voided through the payment');
      }
      if (entry.kind === 'correction') {
        throw new BadRequestException('Corrections cannot be voided');
      }
      if (entry.transferStatus === 'confirmed') {
        throw new BadRequestException('Transfer already confirmed');
      }
      const { count } = await tx.cashEntry.updateMany({
        where: {
          id,
          voidedAt: null,
          OR: [
            { transferStatus: null },
            { transferStatus: { not: 'confirmed' } },
          ],
        },
        data: {
          voidedAt: new Date(),
          voidedById: userId,
          voidReason: dto.reason.trim(),
        },
      });
      const updated = await tx.cashEntry.findUnique({
        where: { id },
        include: entryInclude,
      });
      if (!updated) throw new NotFoundException('Entry not found');
      if (count === 0) {
        if (updated.voidedAt) throw new BadRequestException('Entry is voided');
        throw new BadRequestException('Transfer already confirmed');
      }
      return entryView(updated);
    });
  }

  async recipients(user: AuthenticatedUser, all: boolean): Promise<Person[]> {
    const allowed = all
      ? hasPermission(user, PermissionArea.cash_control, PermissionLevel.view)
      : hasPermission(user, PermissionArea.cash, PermissionLevel.edit);
    if (!allowed) throw new ForbiddenException('Insufficient permissions');
    const users = await this.prisma.user.findMany({
      where: all
        ? { role: { in: STAFF_ROLES } }
        : {
            role: { in: STAFF_ROLES },
            isActive: true,
            id: { not: user.id },
          },
      select: personSelect.select,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users.map(person);
  }

  async myTransfers(userId: string): Promise<CashEntryView[]> {
    const entries = await this.prisma.cashEntry.findMany({
      where: {
        kind: 'transfer',
        recipientId: userId,
        transferStatus: 'pending',
        voidedAt: null,
      },
      include: entryInclude,
      orderBy: { createdAt: 'asc' },
    });
    return entries.map(entryView);
  }

  confirm(id: string, userId: string): Promise<CashEntryView> {
    return this.settle(id, userId, 'confirmed');
  }

  dispute(id: string, dto: DisputeDto, userId: string): Promise<CashEntryView> {
    return this.settle(id, userId, 'disputed', dto.note.trim());
  }

  private settle(
    id: string,
    userId: string,
    status: 'confirmed' | 'disputed',
    note?: string,
  ): Promise<CashEntryView> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.cashEntry.findUnique({ where: { id } });
      if (!entry || entry.kind !== 'transfer') {
        throw new NotFoundException('Entry not found');
      }
      if (entry.recipientId !== userId) {
        throw new ForbiddenException('Not the recipient');
      }
      if (entry.voidedAt) throw new BadRequestException('Entry is voided');
      if (entry.transferStatus !== 'pending') {
        throw new BadRequestException('Transfer already settled');
      }
      const { count } = await tx.cashEntry.updateMany({
        where: { id, transferStatus: 'pending', voidedAt: null },
        data: {
          transferStatus: status,
          transferNote: note ?? null,
          confirmedAt: status === 'confirmed' ? new Date() : undefined,
        },
      });
      if (count === 0) {
        const current = await tx.cashEntry.findUnique({ where: { id } });
        if (current?.voidedAt) throw new BadRequestException('Entry is voided');
        throw new BadRequestException('Transfer already settled');
      }
      if (status === 'disputed') {
        await this.alerts.create(tx, {
          deskId: entry.deskId,
          shiftId: entry.shiftId,
          entryId: id,
          type: 'transfer_disputed',
          amount: entry.amount,
          actorId: userId,
        });
      }
      const updated = await tx.cashEntry.findUnique({
        where: { id },
        include: entryInclude,
      });
      if (!updated) throw new NotFoundException('Entry not found');
      return entryView(updated);
    });
  }
}
