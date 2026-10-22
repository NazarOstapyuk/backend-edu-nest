import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID('4')
  institutionId: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  teacherIds?: string[];

  @IsUUID('4')
  @IsOptional()
  bellScheduleId?: string | null;

  @IsUUID('4')
  @IsOptional()
  mealPriceCategoryId?: string | null;
}
