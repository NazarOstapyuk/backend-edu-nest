import { FinanceCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { AMOUNT_PATTERN } from '../finance-calc';

export class AllocationSuggestionDto {
  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;

  @IsEnum(FinanceCategory)
  @IsOptional()
  category?: FinanceCategory;
}
