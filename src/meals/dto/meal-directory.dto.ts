import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateSortedNamedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateSortedNamedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class CreateDishDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsUUID('4')
  courseId: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;
}

export class UpdateDishDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @IsOptional()
  name?: string;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string | null;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class DishesQueryDto {
  @IsUUID('4')
  @IsOptional()
  courseId?: string;

  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsIn([true, false])
  @IsOptional()
  active?: boolean;
}
