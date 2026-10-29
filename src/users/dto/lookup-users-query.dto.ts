import { IsIn, IsOptional } from 'class-validator';

export class LookupUsersQueryDto {
  @IsIn(['teacher', 'parent'])
  role: 'teacher' | 'parent';

  @IsIn(['true', 'false'])
  @IsOptional()
  includeInactive?: 'true' | 'false';
}
