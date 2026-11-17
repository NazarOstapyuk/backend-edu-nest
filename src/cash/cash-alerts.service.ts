import { Injectable } from '@nestjs/common';
import type { CashAlertType, Prisma } from '@prisma/client';

export interface CashAlertData {
  deskId: string;
  shiftId?: string;
  entryId?: string;
  type: CashAlertType;
  amount?: string | Prisma.Decimal;
  actorId?: string;
}

@Injectable()
export class CashAlertsService {
  create(tx: Prisma.TransactionClient, data: CashAlertData) {
    return tx.cashAlert.create({ data });
  }
}
