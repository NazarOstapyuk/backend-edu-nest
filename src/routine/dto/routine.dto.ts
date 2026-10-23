import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RoutineItemDto {
  @Matches(TIME)
  startTime: string;

  @Matches(TIME)
  endTime: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(300)
  title: string;
}

export class RoutineTemplateItemDto extends RoutineItemDto {
  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;
}

export class UpdateRoutineTemplateDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  workingHours?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;

  @IsArray()
  @ArrayMaxSize(420)
  @ValidateNested({ each: true })
  @Type(() => RoutineTemplateItemDto)
  items: RoutineTemplateItemDto[];
}

export class CreateRoutineTemplateDto extends UpdateRoutineTemplateDto {
  @IsDateString()
  validFrom: string;
}

export class SaveRoutineDayDto {
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => RoutineItemDto)
  items: RoutineItemDto[];
}

export class CopyRoutineDto {
  @IsUUID('4')
  sourceGroupId: string;

  @IsDateString()
  validFrom: string;
}
