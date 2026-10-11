import { FinanceCategory } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../finance-calc';

export class CreateChargeDto {
  @IsEnum(FinanceCategory)
  category: FinanceCategory;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description: string;

  @IsDateString()
  @IsOptional()
  periodStart?: string;

  @IsDateString()
  @IsOptional()
  periodEnd?: string;
}
