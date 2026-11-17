import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  Permission,
  PermissionAny,
} from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { VoidDto } from '../finance/dto/void.dto';
import { CashDesksService } from './cash-desks.service';
import { CashEntriesService } from './cash-entries.service';
import { CashShiftsService } from './cash-shifts.service';
import { CorrectionDto } from './dto/correction.dto';
import { CountDto } from './dto/count.dto';
import { CreateDeskDto } from './dto/create-desk.dto';
import { CreateEntryDto } from './dto/create-entry.dto';
import { DisputeDto } from './dto/dispute.dto';
import { ShiftsQueryDto } from './dto/shifts-query.dto';
import { UpdateDeskDto } from './dto/update-desk.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cash')
export class CashController {
  constructor(
    private desks: CashDesksService,
    private shifts: CashShiftsService,
    private entries: CashEntriesService,
  ) {}

  @PermissionAny(
    [PermissionArea.cash, PermissionArea.cash_control, PermissionArea.finance],
    PermissionLevel.view,
  )
  @Get('desks')
  listDesks(@Query('all') all?: string) {
    return this.desks.list(all === '1');
  }

  @Permission(PermissionArea.cash_control, PermissionLevel.edit)
  @Post('desks')
  createDesk(@Body() dto: CreateDeskDto) {
    return this.desks.create(dto);
  }

  @Permission(PermissionArea.cash_control, PermissionLevel.edit)
  @Patch('desks/:id')
  updateDesk(@Param('id') id: string, @Body() dto: UpdateDeskDto) {
    return this.desks.update(id, dto);
  }

  @Permission(PermissionArea.cash, PermissionLevel.edit)
  @Post('desks/:id/shifts')
  openShift(
    @Param('id') id: string,
    @Body() dto: CountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.open(id, dto, user.id);
  }

  @Permission(PermissionArea.cash, PermissionLevel.edit)
  @Post('shifts/:id/close')
  closeShift(
    @Param('id') id: string,
    @Body() dto: CountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.close(id, dto, user.id);
  }

  @PermissionAny(
    [PermissionArea.cash, PermissionArea.cash_control],
    PermissionLevel.view,
  )
  @Get('shifts')
  listShifts(@Query() query: ShiftsQueryDto) {
    return this.shifts.list(query);
  }

  @PermissionAny(
    [PermissionArea.cash, PermissionArea.cash_control],
    PermissionLevel.view,
  )
  @Get('shifts/:id')
  getShift(@Param('id') id: string) {
    return this.shifts.report(id);
  }

  @Permission(PermissionArea.cash, PermissionLevel.edit)
  @Post('desks/:id/entries')
  createEntry(
    @Param('id') id: string,
    @Body() dto: CreateEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.create(id, dto, user.id);
  }

  @Permission(PermissionArea.cash_control, PermissionLevel.edit)
  @Post('desks/:id/corrections')
  createCorrection(
    @Param('id') id: string,
    @Body() dto: CorrectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.correct(id, dto, user.id);
  }

  @Permission(PermissionArea.cash, PermissionLevel.edit)
  @Post('entries/:id/void')
  voidEntry(
    @Param('id') id: string,
    @Body() dto: VoidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.voidEntry(id, dto, user.id);
  }

  @PermissionAny(
    [PermissionArea.cash, PermissionArea.cash_control],
    PermissionLevel.view,
  )
  @Get('recipients')
  recipients(
    @CurrentUser() user: AuthenticatedUser,
    @Query('all') all?: string,
  ) {
    return this.entries.recipients(user, all === '1');
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get('transfers/mine')
  myTransfers(@CurrentUser() user: AuthenticatedUser) {
    return this.entries.myTransfers(user.id);
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Post('entries/:id/confirm')
  confirmTransfer(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.confirm(id, user.id);
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Post('entries/:id/dispute')
  disputeTransfer(
    @Param('id') id: string,
    @Body() dto: DisputeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.dispute(id, dto, user.id);
  }
}
