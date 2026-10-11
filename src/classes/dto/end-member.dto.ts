import { IsDateString } from 'class-validator';

export class EndMemberDto {
  @IsDateString()
  endDate: string;
}
