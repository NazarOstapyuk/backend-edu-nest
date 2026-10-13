import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { GroupKind } from '@prisma/client';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  teacherIds?: string[];

  @IsEnum(GroupKind)
  @IsOptional()
  kind?: GroupKind;

  @IsUUID('4')
  @IsOptional()
  bellScheduleId?: string | null;

  @IsUUID('4')
  @IsOptional()
  mealPriceCategoryId?: string | null;
}
