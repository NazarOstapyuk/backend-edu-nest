import { WeekParity } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class TimetableEntryDto {
  @IsInt()
  @Min(1)
  @Max(6)
  weekday: number;

  @IsInt()
  @Min(1)
  period: number;

  @IsEnum(WeekParity)
  @IsOptional()
  parity?: WeekParity;

  @IsUUID('4')
  subjectId: string;

  @IsUUID('4')
  teacherId: string;

  @IsUUID('4')
  @IsOptional()
  roomId?: string;

  @IsUUID('4')
  @IsOptional()
  subgroupId?: string;
}

export class TimetableEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimetableEntryDto)
  entries: TimetableEntryDto[];
}

export class CreateTimetableDto extends TimetableEntriesDto {
  @IsString()
  validFrom: string;
}
