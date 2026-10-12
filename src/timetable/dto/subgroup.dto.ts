import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateSubgroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsArray()
  @IsUUID('4', { each: true })
  childIds: string[];
}

export class UpdateSubgroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  childIds?: string[];
}
