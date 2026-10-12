import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { GroupKind } from '@prisma/client';

export class UpdateGroupDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  teacherIds?: string[];

  @IsEnum(GroupKind)
  @IsOptional()
  kind?: GroupKind;

  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  @IsOptional()
  bellScheduleId?: string | null;
}
