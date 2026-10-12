import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { checkBellPeriods } from './schedule-calc';
import {
  BellPeriodDto,
  CreateBellScheduleDto,
  UpdateBellScheduleDto,
} from './dto/bell-schedule.dto';

const withPeriods = {
  periods: {
    select: { number: true, startTime: true, endTime: true },
    orderBy: { number: 'asc' },
  },
} as const;

@Injectable()
export class BellSchedulesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.bellSchedule.findMany({
      include: withPeriods,
      orderBy: { name: 'asc' },
    });
  }

  private assertPeriods(periods: BellPeriodDto[]) {
    const problem = checkBellPeriods(periods);
    if (problem) throw new BadRequestException(problem);
  }

  async create(dto: CreateBellScheduleDto) {
    const name = dto.name.trim();
    this.assertPeriods(dto.periods);
    if (await this.prisma.bellSchedule.findUnique({ where: { name } }))
      throw new ConflictException('Bell schedule already exists');
    return this.prisma.bellSchedule.create({
      data: { name, periods: { create: dto.periods } },
      include: withPeriods,
    });
  }

  async update(id: string, dto: UpdateBellScheduleDto) {
    const schedule = await this.prisma.bellSchedule.findUnique({
      where: { id },
    });
    if (!schedule) throw new NotFoundException('Bell schedule not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== schedule.name &&
      (await this.prisma.bellSchedule.findUnique({ where: { name } }))
    )
      throw new ConflictException('Bell schedule already exists');
    const periods = dto.periods;
    if (periods) {
      this.assertPeriods(periods);
      const used = await this.prisma.timetableEntry.findMany({
        where: { timetable: { group: { bellScheduleId: id } } },
        select: { period: true },
        distinct: ['period'],
      });
      const numbers = new Set(periods.map((p) => p.number));
      if (used.some((u) => !numbers.has(u.period)))
        throw new BadRequestException('Bell period is in use');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.bellSchedule.update({
        where: { id },
        data: { name, active: dto.active },
      });
      if (periods) {
        await tx.bellPeriod.deleteMany({ where: { scheduleId: id } });
        await tx.bellPeriod.createMany({
          data: periods.map((p) => ({ ...p, scheduleId: id })),
        });
      }
      return tx.bellSchedule.findUnique({
        where: { id },
        include: withPeriods,
      });
    });
  }
}
