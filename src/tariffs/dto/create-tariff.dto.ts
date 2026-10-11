import { BillingMode, FinanceCategory, TariffUnit } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class CreateTariffDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsEnum(FinanceCategory)
  category: FinanceCategory;

  @IsEnum(TariffUnit)
  unit: TariffUnit;

  @IsInt()
  @Min(2)
  @Max(100)
  @IsOptional()
  packageSize?: number;

  @IsEnum(BillingMode)
  billingMode: BillingMode;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  price: string;

  @IsDateString()
  effectiveFrom: string;
}
