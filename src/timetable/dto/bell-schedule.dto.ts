import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class BellPeriodDto {
  @IsInt()
  @Min(1)
  number: number;

  @Matches(TIME)
  startTime: string;

  @Matches(TIME)
  endTime: string;
}

export class CreateBellScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BellPeriodDto)
  periods: BellPeriodDto[];
}

export class UpdateBellScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BellPeriodDto)
  @IsOptional()
  periods?: BellPeriodDto[];
}
