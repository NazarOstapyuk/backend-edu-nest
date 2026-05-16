import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateAttendanceDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
