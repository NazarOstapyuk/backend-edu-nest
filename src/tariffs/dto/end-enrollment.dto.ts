import { IsDateString } from 'class-validator';

export class EndEnrollmentDto {
  @IsDateString()
  endDate: string;
}
