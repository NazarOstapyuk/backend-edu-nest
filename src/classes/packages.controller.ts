import {
  Body,
  Controller,
  Get,
  HttpCode,
  ParseUUIDPipe,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { VoidDto } from '../finance/dto/void.dto';
import { ClearExpiryDto } from './dto/clear-expiry.dto';
import { ExtendPackageDto } from './dto/extend-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import { ReconcilePackageDto } from './dto/reconcile-package.dto';
import { LegacyService } from './legacy.service';
import { PackagesService } from './packages.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.classes, PermissionLevel.view)
@Controller()
export class PackagesController {
  constructor(
    private packages: PackagesService,
    private legacy: LegacyService,
  ) {}

  @Get('children/:childId/packages')
  list(@Param('childId') childId: string) {
    return this.packages.listForChild(childId);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post('children/:childId/packages')
  purchase(
    @Param('childId') childId: string,
    @Body() dto: PurchasePackageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.packages.purchase(childId, dto, user);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post('packages/:id/extend')
  extend(
    @Param('id') id: string,
    @Body() dto: ExtendPackageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.packages.extend(id, dto, user.id);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post('packages/:id/void')
  void(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.packages.void(id, dto.reason, user.id);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post('packages/:id/reconcile')
  reconcile(
    @Param('id') id: string,
    @Body() dto: ReconcilePackageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.packages.reconcile(id, dto, user.id);
  }

  @Get('packages/with-expiry')
  countWithExpiry(@Query('tariffId', ParseUUIDPipe) tariffId: string) {
    return this.packages.countWithExpiry(tariffId);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post('packages/clear-expiry')
  @HttpCode(200)
  clearExpiry(
    @Body() dto: ClearExpiryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.packages.clearExpiry(dto.tariffId, dto.reason, user.id);
  }

  @Get('packages/reconciliation')
  reconciliation() {
    return this.packages.reconciliationList();
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post('legacy/subscriptions/migrate')
  @HttpCode(200)
  migrate(@CurrentUser() user: AuthenticatedUser) {
    return this.legacy.migrate(user.id);
  }
}
