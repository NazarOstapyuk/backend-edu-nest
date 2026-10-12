import { NoticeStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListNoticesQueryDto {
  @IsEnum(NoticeStatus)
  @IsOptional()
  status?: NoticeStatus;

  @IsUUID('4')
  @IsOptional()
  groupId?: string;
}
