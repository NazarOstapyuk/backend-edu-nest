import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  Permission,
  PermissionAny,
} from '../common/decorators/permission.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { isoDay, kyivToday } from '../tariffs/dates';
import { ReportQueryDto } from './dto/report-query.dto';
import { ActivityReportsService } from './activity-reports.service';
import { FinanceReportsService } from './finance-reports.service';
import { Report } from './report.types';
import { renderXlsx } from './xlsx-writer';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private finance: FinanceReportsService,
    private activity: ActivityReportsService,
  ) {}

  @Get('payments')
  @Permission(PermissionArea.finance, PermissionLevel.view)
  async payments(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.finance.payments(query, user), query, res);
  }

  @Get('charges')
  @Permission(PermissionArea.finance, PermissionLevel.view)
  async charges(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.finance.charges(query, user), query, res);
  }

  @Get('debts')
  @Permission(PermissionArea.finance, PermissionLevel.view)
  async debts(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.finance.debts(query, user), query, res);
  }

  @Get('attendance')
  @Permission(PermissionArea.register, PermissionLevel.view)
  async attendance(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      await this.activity.attendance(query, user),
      query,
      res,
    );
  }

  @Get('lessons')
  @PermissionAny(
    [PermissionArea.timetable, PermissionArea.classes],
    PermissionLevel.view,
  )
  async lessons(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.activity.lessons(query, user), query, res);
  }

  @Get('meals')
  @Permission(PermissionArea.meals, PermissionLevel.view)
  async meals(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.activity.meals(query, user), query, res);
  }

  @Get('payroll')
  @Permission(PermissionArea.payroll, PermissionLevel.view)
  async payroll(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.activity.payroll(query, user), query, res);
  }

  private async respond(report: Report, query: ReportQueryDto, res: Response) {
    if (query.format !== 'xlsx') return report;
    const suffix = report.period
      ? `_${report.period.from}_${report.period.to}`
      : `_${isoDay(kyivToday())}`;
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${report.fileName}${suffix}.xlsx`)}`,
    });
    return new StreamableFile(await renderXlsx(report));
  }
}
