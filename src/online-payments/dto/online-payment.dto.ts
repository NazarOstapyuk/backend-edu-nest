import { FinanceCategory } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class PayCategoryDto {
  @IsEnum(FinanceCategory)
  category: FinanceCategory;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;
}

export class CreateLinkDto extends PayCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class TestResultDto {
  @IsIn(['success', 'failure'])
  result: 'success' | 'failure';
}
