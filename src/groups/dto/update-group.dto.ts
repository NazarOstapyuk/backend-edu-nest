import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class UpdateGroupDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsUUID('4')
  @IsOptional()
  institutionId?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  teacherIds?: string[];

  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  @IsOptional()
  bellScheduleId?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  @IsOptional()
  mealPriceCategoryId?: string | null;
}
