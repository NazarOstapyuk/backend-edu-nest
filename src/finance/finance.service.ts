import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { scopeIds } from '../access/access-calc';
import { assertChildInScope, childScopeWhere } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { AllocationSuggestionDto } from './dto/allocation-suggestion.dto';
import { BalancesQueryDto } from './dto/balances-query.dto';
import { money, suggestAllocation } from './finance-calc';
import {
  PersonRef,
  balanceChildSelect,
  buildBalanceRow,
  buildChildFinance,
  buildHistory,
  chargeInclude,
  paymentInclude,
} from './finance-view';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  private async findChild(childId: string): Promise<PersonRef> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!child) throw new NotFoundException('Child not found');
    return child;
  }

  private loadRecords(childId: string) {
    return Promise.all([
      this.prisma.charge.findMany({
        where: { childId },
        include: chargeInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.findMany({
        where: { childId },
        include: paymentInclude,
        orderBy: { receivedAt: 'desc' },
      }),
    ]);
  }

  async getChildFinance(childId: string, user: AuthenticatedUser) {
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    const child = await this.findChild(childId);
    const [charges, payments] = await this.loadRecords(childId);
    const parents = await this.prisma.user.findMany({
      where: { children: { some: { id: childId } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phone: true,
        email: true,
      },
      orderBy: { lastName: 'asc' },
    });
    return { ...buildChildFinance(child, charges, payments), parents };
  }

  async getHistory(childId: string, user: AuthenticatedUser) {
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    await this.findChild(childId);
    const [charges, payments] = await this.loadRecords(childId);
    return buildHistory(charges, payments);
  }

  async suggest(
    childId: string,
    dto: AllocationSuggestionDto,
    user: AuthenticatedUser,
  ) {
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    await this.findChild(childId);
    const amount = money(dto.amount);
    if (amount.lte(0))
      throw new BadRequestException('Amount must be greater than 0');

    const charges = await this.prisma.charge.findMany({
      where: { childId, voidedAt: null, category: dto.category },
      include: { allocations: { where: { voidedAt: null } } },
    });
    return suggestAllocation(charges, amount);
  }

  async getBalances(query: BalancesQueryDto, user: AuthenticatedUser) {
    const children = await this.prisma.child.findMany({
      where: {
        ...childScopeWhere(scopeIds(user)),
        ...(query.groupId ? { groupId: query.groupId } : {}),
      },
      select: balanceChildSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return children
      .map((child) =>
        buildBalanceRow(child, child.charges, child.payments, query.category),
      )
      .filter((row) => query.hasDebt !== 'true' || money(row.debt).gt(0))
      .filter(
        (row) =>
          query.hasUnallocated !== 'true' || money(row.unallocated).gt(0),
      );
  }
}
