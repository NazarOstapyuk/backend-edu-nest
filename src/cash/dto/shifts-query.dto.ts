import { IsOptional, IsUUID, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ShiftsQueryDto {
  @IsOptional()
  @IsUUID('4')
  deskId?: string;

  @IsOptional()
  @Matches(DAY)
  from?: string;

  @IsOptional()
  @Matches(DAY)
  to?: string;

  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
