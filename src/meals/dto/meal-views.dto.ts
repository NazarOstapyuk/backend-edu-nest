import { GroupKind } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class MealOrdersQueryDto {
  @IsDateString()
  date: string;

  @IsEnum(GroupKind)
  @IsOptional()
  kind?: GroupKind;

  @IsUUID('4')
  @IsOptional()
  groupId?: string;
}

export class TodayOrdersQueryDto {
  @IsUUID('4')
  groupId: string;
}

export class ParentMenuQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
