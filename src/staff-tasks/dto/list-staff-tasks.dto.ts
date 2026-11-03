import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class ListStaffTasksDto {
  @IsOptional()
  @IsDateString()
  before?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  all?: 'true' | 'false';
}
