import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const positiveAmount = (value: string) => {
  const amount = new Prisma.Decimal(value);
  if (amount.lte(0))
    throw new BadRequestException('Amount must be greater than 0');
  return amount;
};
