import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export const RECONCILE_OUTCOMES = [
  'paid_full',
  'paid_partial',
  'not_paid',
] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

export class ReconcilePackageDto {
  @IsIn(RECONCILE_OUTCOMES)
  outcome: ReconcileOutcome;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  @IsOptional()
  paidAmount?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}
