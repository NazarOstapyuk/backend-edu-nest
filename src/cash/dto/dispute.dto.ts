import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class DisputeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  note: string;
}
