import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export class CreateAdaptationVisitDto {
  @IsUUID('4')
  tariffId: string;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/)
  hours: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  @IsOptional()
  ratePerHour?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}
