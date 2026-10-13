import { GroupKind } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class MenuPeriodDto {
  @IsEnum(GroupKind)
  kind: GroupKind;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class SaveMenuDayDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  dishIds: string[];
}

export class CopyMenuDto {
  @IsEnum(GroupKind)
  kind: GroupKind;

  @IsDateString()
  fromStart: string;

  @IsDateString()
  fromEnd: string;

  @IsDateString()
  toStart: string;

  @IsBoolean()
  @IsOptional()
  overwrite?: boolean;
}
