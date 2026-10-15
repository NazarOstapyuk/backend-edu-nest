import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { SalaryTermsService } from './salary-terms.service';
import {
  CloseSalaryTermsDto,
  CreateSalaryTermsDto,
  SalaryTermsQueryDto,
  UpdateSalaryTermsDto,
} from './dto/salary-terms.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.payroll, PermissionLevel.view)
@Controller('salary-terms')
export class SalaryTermsController {
  constructor(private terms: SalaryTermsService) {}

  @Get()
  list(@Query() query: SalaryTermsQueryDto) {
    return this.terms.list(query.teacherId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.terms.get(id);
  }

  @Permission(PermissionArea.payroll, PermissionLevel.edit)
  @Post()
  create(
    @Body() dto: CreateSalaryTermsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.terms.create(dto, user);
  }

  @Permission(PermissionArea.payroll, PermissionLevel.edit)
  @Patch(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseSalaryTermsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.terms.close(id, dto, user.id);
  }

  @Permission(PermissionArea.payroll, PermissionLevel.edit)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryTermsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.terms.update(id, dto, user.id);
  }

  @Permission(PermissionArea.payroll, PermissionLevel.edit)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.terms.remove(id, user.id);
  }
}
