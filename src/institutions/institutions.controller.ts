import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';
import { InstitutionsService } from './institutions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('institutions')
export class InstitutionsController {
  constructor(private institutions: InstitutionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.institutions.list(user);
  }

  @Permission(PermissionArea.settings, PermissionLevel.edit)
  @Post()
  create(
    @Body() dto: CreateInstitutionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.institutions.create(dto, user);
  }

  @Permission(PermissionArea.settings, PermissionLevel.edit)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInstitutionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.institutions.update(id, dto, user);
  }
}
