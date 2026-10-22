import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AccessScope, PermissionArea, PermissionLevel } from '@prisma/client';

export class PermissionItemDto {
  @IsEnum(PermissionArea)
  area: PermissionArea;

  @IsEnum(PermissionLevel)
  level: PermissionLevel;
}

export class UpdateAccessDto {
  @IsIn([AccessScope.all, AccessScope.institutions])
  accessScope: AccessScope;

  @ValidateIf(
    (o: UpdateAccessDto) => o.accessScope === AccessScope.institutions,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  institutionIds?: string[];

  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PermissionItemDto)
  permissions: PermissionItemDto[];
}
