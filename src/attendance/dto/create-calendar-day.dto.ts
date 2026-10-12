import { CalendarDayType, CalendarScope } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCalendarDayDto {
  @IsString()
  startDate: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsEnum(CalendarDayType)
  type: CalendarDayType;

  @IsEnum(CalendarScope)
  scope: CalendarScope;

  @IsUUID('4')
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}
