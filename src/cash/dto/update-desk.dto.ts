import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';
import { CLOSE_BY_PATTERN } from './create-desk.dto';

export class UpdateDeskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(AMOUNT_PATTERN)
  largeAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(CLOSE_BY_PATTERN)
  closeBy?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
