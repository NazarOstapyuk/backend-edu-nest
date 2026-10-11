import { IsDateString, IsString, Matches } from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class AddTariffPriceDto {
  @IsString()
  @Matches(AMOUNT_PATTERN)
  price: string;

  @IsDateString()
  effectiveFrom: string;
}
