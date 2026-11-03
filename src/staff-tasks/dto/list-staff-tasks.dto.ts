import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListStaffTasksDto {
  @IsOptional()
  @IsString()
  before?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  all?: 'true' | 'false';
}
