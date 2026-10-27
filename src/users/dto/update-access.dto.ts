import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { AccessScope, PermissionArea, PermissionLevel } from '@prisma/client';

export class PermissionItemDto {
  @IsEnum(PermissionArea)
  area: PermissionArea;

  @IsEnum(PermissionLevel)
  level: PermissionLevel;
}

export class UpdateAccessDto {
  @IsUUID('4')
  positionId: string;

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
}
