import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CountDto {
  @IsObject()
  denominations: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
