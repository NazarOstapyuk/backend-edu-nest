import {
  CashDirection,
  CashEntryKind,
  FinanceCategory,
  GroupKind,
} from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ReportQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsEnum(GroupKind)
  kind?: GroupKind;

  @IsOptional()
  @IsUUID('4')
  institutionId?: string;

  @IsOptional()
  @IsUUID('4')
  groupId?: string;

  @IsOptional()
  @IsUUID('4')
  childId?: string;

  @IsOptional()
  @IsUUID('4')
  teacherId?: string;

  @IsOptional()
  @IsUUID('4')
  tariffId?: string;

  @IsOptional()
  @IsUUID('4')
  deskId?: string;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsOptional()
  @IsUUID('4')
  shiftId?: string;

  @IsOptional()
  @IsEnum(CashDirection)
  direction?: CashDirection;

  @IsOptional()
  @IsEnum(FinanceCategory)
  category?: FinanceCategory;

  @IsOptional()
  @IsEnum(CashEntryKind)
  entryKind?: CashEntryKind;

  @IsOptional()
  @IsIn(['json', 'xlsx'])
  format?: 'json' | 'xlsx';
}
