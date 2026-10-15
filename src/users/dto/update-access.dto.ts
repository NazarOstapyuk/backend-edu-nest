import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { AccessScope, PermissionArea, PermissionLevel } from '@prisma/client';

export class PermissionItemDto {
  @IsEnum(PermissionArea)
  area: PermissionArea;

  @IsEnum(PermissionLevel)
  level: PermissionLevel;
}

export class UpdateAccessDto {
  @IsEnum(AccessScope)
  accessScope: AccessScope;

  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PermissionItemDto)
  permissions: PermissionItemDto[];
}
