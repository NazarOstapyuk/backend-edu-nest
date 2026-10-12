import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnChild } from '../common/ownership';
import { isoDay } from '../tariffs/dates';
import { parseMonth, summarizeDays } from './register-calc';
import { RegisterService } from './register.service';

@Injectable()
export class ParentAttendanceService {
  constructor(
    private prisma: PrismaService,
    private register: RegisterService,
  ) {}

  async month(parentId: string, childId: string, monthValue: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const { from, to } = parseMonth(monthValue);
    const [rows, reasons] = await Promise.all([
      this.register.childDays([childId], from, to),
      this.prisma.absenceReason.findMany({
        select: { id: true, name: true, excused: true },
      }),
    ]);
    const names = new Map(reasons.map((r) => [r.id, r.name]));
    const excused = new Set(reasons.filter((r) => r.excused).map((r) => r.id));
    const days = rows[0]?.days ?? [];
    return {
      month: monthValue,
      days: days.map((d) => ({
        date: isoDay(d.date),
        state: d.state,
        status: d.status,
        reasonName: d.reasonId ? (names.get(d.reasonId) ?? null) : null,
        title: d.title,
      })),
      summary: summarizeDays(days, excused),
    };
  }
}
