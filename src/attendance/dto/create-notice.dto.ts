import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateNoticeDto {
  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsUUID('4')
  reasonId: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  comment?: string;
}
