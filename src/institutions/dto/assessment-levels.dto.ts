import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';

export class AssessmentLevelDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsInt()
  minPercent: number;
}

export class SetAssessmentLevelsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssessmentLevelDto)
  levels: AssessmentLevelDto[];
}
