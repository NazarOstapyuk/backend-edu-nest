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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { SalaryTermsService } from './salary-terms.service';
import {
  CloseSalaryTermsDto,
  CreateSalaryTermsDto,
  SalaryTermsQueryDto,
  UpdateSalaryTermsDto,
} from './dto/salary-terms.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
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

  @Post()
  create(
    @Body() dto: CreateSalaryTermsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.terms.create(dto, user);
  }

  @Patch(':id/close')
  close(@Param('id') id: string, @Body() dto: CloseSalaryTermsDto) {
    return this.terms.close(id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalaryTermsDto) {
    return this.terms.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.terms.remove(id);
  }
}
