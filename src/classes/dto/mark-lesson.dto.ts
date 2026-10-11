import { AttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class MarkItemDto {
  @IsUUID('4')
  childId: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsBoolean()
  @IsOptional()
  isGuest?: boolean;
}

export class MarkLessonDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MarkItemDto)
  marks: MarkItemDto[];

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
