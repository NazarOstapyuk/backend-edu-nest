import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PayrollAdjustmentKind, PayrollPaymentMethod } from '@prisma/client';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class PayrollListQueryDto {
  @IsString()
  month: string;
}

export class MyPayrollQueryDto {
  @IsString()
  year: string;
}

export class WorkedDaysDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  workedDays?: number | null;
}

export class PayrollAdjustmentDto {
  @IsEnum(PayrollAdjustmentKind)
  kind: PayrollAdjustmentKind;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}

export class PayrollPaymentDto {
  @IsDateString()
  date: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;

  @IsEnum(PayrollPaymentMethod)
  method: PayrollPaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
