import { CashDirection, CashExpenseCategory } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class CreateEntryDto {
  @IsIn(['expense', 'transfer'])
  kind: 'expense' | 'transfer';

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;

  @IsOptional()
  @IsEnum(CashDirection)
  direction?: CashDirection;

  @IsOptional()
  @IsEnum(CashExpenseCategory)
  expenseCategory?: CashExpenseCategory;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  recipientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
