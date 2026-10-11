import { FinanceCategory } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

export class BalancesQueryDto {
  @IsEnum(FinanceCategory)
  @IsOptional()
  category?: FinanceCategory;

  @IsIn(['true', 'false'])
  @IsOptional()
  hasDebt?: 'true' | 'false';

  @IsIn(['true', 'false'])
  @IsOptional()
  hasUnallocated?: 'true' | 'false';
}
