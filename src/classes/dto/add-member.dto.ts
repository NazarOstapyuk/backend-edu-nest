import { IsDateString, IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsUUID('4')
  childId: string;

  @IsDateString()
  startDate: string;
}
