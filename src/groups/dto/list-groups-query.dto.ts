import { IsOptional, IsUUID } from 'class-validator';

export class ListGroupsQueryDto {
  @IsUUID('4')
  @IsOptional()
  institutionId?: string;
}
