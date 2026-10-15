import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { VoidDto } from '../finance/dto/void.dto';
import { AdaptationService } from './adaptation.service';
import { CreateAdaptationVisitDto } from './dto/create-adaptation-visit.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.tariffs, PermissionLevel.view)
@Controller()
export class AdaptationController {
  constructor(private adaptation: AdaptationService) {}

  @Get('children/:childId/adaptation-visits')
  list(
    @Param('childId') childId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adaptation.listForChild(childId, user);
  }

  @Permission(PermissionArea.tariffs, PermissionLevel.edit)
  @Post('children/:childId/adaptation-visits')
  create(
    @Param('childId') childId: string,
    @Body() dto: CreateAdaptationVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adaptation.create(childId, dto, user.id, user);
  }

  @Permission(PermissionArea.tariffs, PermissionLevel.edit)
  @Post('adaptation-visits/:id/void')
  void(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adaptation.void(id, dto.reason, user.id, user);
  }
}
