import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AttendancesService } from './attendances.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscriptions/:subscriptionId/attendances')
export class AttendancesController {
  constructor(private service: AttendancesService) {}

  @Roles(Role.root, Role.admin, Role.teacher)
  @Post()
  create(
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: CreateAttendanceDto,
  ) {
    return this.service.create(subscriptionId, dto);
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get()
  findAll(@Param('subscriptionId') subscriptionId: string) {
    return this.service.findBySubscription(subscriptionId);
  }

  @Roles(Role.root, Role.admin)
  @Delete(':id')
  delete(
    @Param('subscriptionId') subscriptionId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(subscriptionId, id);
  }
}
