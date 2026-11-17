import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ShiftsQueryDto {
  @IsOptional()
  @IsUUID('4')
  deskId?: string;

  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
