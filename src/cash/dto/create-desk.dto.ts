import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export const CLOSE_BY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateDeskDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  name: string;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  largeAmount: string;

  @IsString()
  @Matches(CLOSE_BY_PATTERN)
  closeBy: string;
}
