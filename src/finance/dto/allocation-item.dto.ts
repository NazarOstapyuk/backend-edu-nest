import { IsString, IsUUID, Matches } from 'class-validator';
import { AMOUNT_PATTERN } from '../finance-calc';

export class AllocationItemDto {
  @IsUUID('4')
  chargeId: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount: string;
}
