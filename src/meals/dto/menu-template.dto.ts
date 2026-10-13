import { Type } from 'class-transformer';
import { GroupKind } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  Matches,
} from 'class-validator';

export class CreateMenuTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsInt()
  @Min(1)
  @Max(8)
  weeks: number;
}

export class UpdateMenuTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(1)
  @Max(8)
  @IsOptional()
  weeks?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class TemplateItemDto {
  @IsInt()
  @Min(1)
  @Max(8)
  week: number;

  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;

  @IsUUID('4')
  dishId: string;
}

export class SaveTemplateItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items: TemplateItemDto[];
}

export class ApplyTemplateDto {
  @IsEnum(GroupKind)
  kind: GroupKind;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsInt()
  @Min(1)
  @Max(8)
  startWeek: number;

  @IsBoolean()
  @IsOptional()
  overwrite?: boolean;
}
