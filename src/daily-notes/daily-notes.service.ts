import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NoteQuestionType,
  NoticeStatus,
  PermissionLevel,
  Prisma,
} from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { groupScopeWhere } from '../access/scope';
import { CalendarService } from '../attendance/calendar.service';
import { dayInfo, resolveDay } from '../attendance/register-calc';
import {
  canManageRegister,
  RegisterService,
} from '../attendance/register.service';
import { parseDay } from '../classes/access';
import { assertOwnChild } from '../common/ownership';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { SaveNotesDto } from './dto/save-notes.dto';
import {
  AnswerValue,
  isComplete,
  normalizeAnswer,
  pendingForGroup,
} from './notes-calc';

const MAX_DAYS = 62;

const time = (day: Date) => day.getTime();

const childSelect = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
} as const;

const presenceSelect = (date: Date) =>
  ({
    dailyAttendances: {
      where: { date, voidedAt: null },
      select: { date: true, status: true, reasonId: true, voidedAt: true },
    },
    absenceNotices: {
      where: {
        status: NoticeStatus.approved,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { startDate: true, endDate: true, reasonId: true, status: true },
    },
  }) as const;

const questionSelect = {
  id: true,
  text: true,
  type: true,
  required: true,
  options: true,
  min: true,
  max: true,
  unit: true,
  sortOrder: true,
} as const;

type StoredValue = {
  questionType: NoteQuestionType;
  valueText: string | null;
  valueBool: boolean | null;
  valueNumber: Prisma.Decimal | null;
};

type Presence = {
  dailyAttendances: Parameters<typeof resolveDay>[2];
  absenceNotices: Parameters<typeof resolveDay>[3];
};

const answerValue = (a: StoredValue): string | number | boolean | null => {
  if (a.questionType === NoteQuestionType.yes_no) return a.valueBool;
  if (a.questionType === NoteQuestionType.number)
    return a.valueNumber === null ? null : a.valueNumber.toNumber();
  return a.valueText;
};

const decimalText = (value: Prisma.Decimal | null) =>
  value === null ? null : value.toFixed(2);

const sameValue = (a: StoredValue, b: AnswerValue) =>
  a.valueText === b.valueText &&
  a.valueBool === b.valueBool &&
  decimalText(a.valueNumber) === b.valueNumber;

const isAbsent = (date: Date, working: boolean, child: Presence) => {
  const state = resolveDay(
    date,
    working,
    child.dailyAttendances,
    child.absenceNotices,
  ).state;
  return state === 'absent' || state === 'expected_absent';
};

const answeredMap = (rows: { childId: string; questionId: string }[]) => {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.childId) ?? new Set<string>();
    set.add(row.questionId);
    map.set(row.childId, set);
  }
  return map;
};

const staffGroupWhere = (user: AuthenticatedUser): Prisma.GroupWhereInput => ({
  ...(canManageRegister(user) ? {} : { teachers: { some: { id: user.id } } }),
  ...groupScopeWhere(scopeIds(user)),
  noteSets: { some: { active: true } },
});

export type PendingNotesRow = {
  group: { id: string; name: string };
  own: boolean;
  pending: number;
  overdue: boolean;
};

@Injectable()
export class DailyNotesService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    private register: RegisterService,
  ) {}

  groups(user: AuthenticatedUser) {
    return this.prisma.group.findMany({
      where: staffGroupWhere(user),
      select: {
        id: true,
        name: true,
        kind: true,
        institution: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  private async loadGroup(
    groupId: string,
    user: AuthenticatedUser,
    level: PermissionLevel = PermissionLevel.view,
  ) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        kind: true,
        institutionId: true,
        teachers: { select: { id: true } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    const ids = scopeIds(user);
    if (ids && !ids.includes(group.institutionId))
      throw new NotFoundException('Group not found');
    if (
      !canManageRegister(user, level) &&
      !group.teachers.some((t) => t.id === user.id)
    ) {
      throw new ForbiddenException('Not your group');
    }
    return group;
  }

  private async activeSets(groupId: string) {
    const sets = await this.prisma.noteSet.findMany({
      where: { active: true, groups: { some: { id: groupId } } },
      select: {
        id: true,
        name: true,
        deadline: true,
        questions: {
          where: { active: true },
          select: questionSelect,
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    return sets.filter((set) => set.questions.length > 0);
  }

  async day(
    groupId: string,
    dateValue: string,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    const group = await this.loadGroup(groupId, user);
    const date = parseDay(dateValue);
    const today = kyivToday(now);
    const [entries, editDays, sets, children] = await Promise.all([
      this.calendar.entriesBetween(date, date),
      this.register.getEditDays(),
      this.activeSets(groupId),
      this.prisma.child.findMany({
        where: { groupId },
        select: { ...childSelect, ...presenceSelect(date) },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
    ]);
    const answers = children.length
      ? await this.prisma.noteAnswer.findMany({
          where: {
            childId: { in: children.map((c) => c.id) },
            date,
            voidedAt: null,
          },
          select: {
            childId: true,
            questionId: true,
            questionText: true,
            questionType: true,
            unit: true,
            valueText: true,
            valueBool: true,
            valueNumber: true,
            createdAt: true,
            answeredBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: [
            { question: { set: { name: 'asc' } } },
            { question: { sortOrder: 'asc' } },
          ],
        })
      : [];

    const info = dayInfo(date, group, entries);
    const window = time(date) >= time(addDays(today, -editDays));
    const notFuture = time(date) <= time(today);
    const manager = canManageRegister(user, PermissionLevel.edit);
    const teaches = group.teachers.some((t) => t.id === user.id);
    const answered = answeredMap(answers);
    const empty = new Set<string>();

    const rows = children.map((child) => {
      const absent = isAbsent(date, info.working, child);
      const own = answered.get(child.id) ?? empty;
      return {
        child: {
          id: child.id,
          firstName: child.firstName,
          lastName: child.lastName,
          middleName: child.middleName,
        },
        absent,
        expected: info.working && !absent,
        complete: sets.every((set) => isComplete(set.questions, own)),
        answers: answers
          .filter((a) => a.childId === child.id)
          .map((a) => ({
            questionId: a.questionId,
            questionText: a.questionText,
            questionType: a.questionType,
            unit: a.unit,
            value: answerValue(a),
            answeredBy: a.answeredBy,
            createdAt: a.createdAt,
          })),
      };
    });
    const expectedIds = rows.filter((r) => r.expected).map((r) => r.child.id);

    return {
      date: isoDay(date),
      working: info.working,
      calendarTitle: info.title,
      canEdit: notFuture && (manager || (teaches && window)),
      needsReason: manager && !window,
      sets: sets.map((set) => ({
        id: set.id,
        name: set.name,
        deadline: set.deadline,
        overdue:
          info.working &&
          pendingForGroup([set], expectedIds, answered, date, now).overdue,
        questions: set.questions.map((q) => ({
          id: q.id,
          text: q.text,
          type: q.type,
          required: q.required,
          options: q.options,
          min: q.min === null ? null : q.min.toNumber(),
          max: q.max === null ? null : q.max.toNumber(),
          unit: q.unit,
        })),
      })),
      children: rows,
    };
  }

  async save(
    groupId: string,
    dateValue: string,
    dto: SaveNotesDto,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    await this.loadGroup(groupId, user, PermissionLevel.edit);
    const date = parseDay(dateValue);
    const today = kyivToday(now);
    if (time(date) > time(today))
      throw new BadRequestException('Cannot fill future days');
    const editDays = await this.register.getEditDays();
    const reason = dto.reason?.trim() || null;
    if (time(date) < time(addDays(today, -editDays))) {
      if (!canManageRegister(user, PermissionLevel.edit))
        throw new ForbiddenException('Edit window has passed');
      if (!reason) throw new BadRequestException('Reason is required');
    }
    const keys = dto.answers.map((a) => `${a.childId}:${a.questionId}`);
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('Duplicate answer');

    if (dto.answers.length) {
      const childIds = [...new Set(dto.answers.map((a) => a.childId))].sort();
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Child" WHERE id IN (${Prisma.join(childIds)}) ORDER BY id FOR UPDATE`;
        const members = await tx.child.findMany({
          where: { id: { in: childIds } },
          select: { id: true, groupId: true },
        });
        const inGroup = new Set(
          members.filter((c) => c.groupId === groupId).map((c) => c.id),
        );
        if (childIds.some((id) => !inGroup.has(id)))
          throw new BadRequestException('Child is not in this group');

        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT s.id FROM "NoteSet" s
          JOIN "_NoteSetGroups" g ON g."B" = s.id
          WHERE g."A" = ${groupId} AND s.active = true
          ORDER BY s.id FOR SHARE OF s`;
        const setIds = locked.map((s) => s.id);
        const questions = setIds.length
          ? await tx.noteQuestion.findMany({
              where: { setId: { in: setIds }, active: true },
              select: questionSelect,
            })
          : [];
        const byId = new Map(questions.map((q) => [q.id, q]));

        const changes = dto.answers.map((a) => {
          const q = byId.get(a.questionId);
          if (!q)
            throw new BadRequestException('Question is not in this group');
          const result = normalizeAnswer(
            {
              type: q.type,
              options: q.options,
              min: decimalText(q.min),
              max: decimalText(q.max),
            },
            a.value,
          );
          if ('error' in result) throw new BadRequestException(result.error);
          return { input: a, question: q, result };
        });

        const active = await tx.noteAnswer.findMany({
          where: {
            childId: { in: childIds },
            date,
            voidedAt: null,
            questionId: { in: [...byId.keys()] },
          },
        });
        const voidedAt = new Date();
        for (const { input, question, result } of changes) {
          const existing = active.find(
            (row) =>
              row.childId === input.childId &&
              row.questionId === input.questionId,
          );
          if (result.clear) {
            if (existing)
              await tx.noteAnswer.update({
                where: { id: existing.id },
                data: {
                  voidedAt,
                  voidedById: user.id,
                  voidReason: reason ?? 'Cleared',
                },
              });
            continue;
          }
          if (
            existing &&
            existing.groupId === groupId &&
            sameValue(existing, result.value)
          )
            continue;
          if (existing)
            await tx.noteAnswer.update({
              where: { id: existing.id },
              data: {
                voidedAt,
                voidedById: user.id,
                voidReason: reason ?? 'Corrected',
              },
            });
          await tx.noteAnswer.create({
            data: {
              childId: input.childId,
              groupId,
              questionId: question.id,
              date,
              questionText: question.text,
              questionType: question.type,
              unit: question.unit,
              ...result.value,
              answeredById: user.id,
            },
          });
        }
      });
    }
    return this.day(groupId, dateValue, user, now);
  }

  async pending(
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<PendingNotesRow[]> {
    const today = kyivToday(now);
    const groups = await this.prisma.group.findMany({
      where: staffGroupWhere(user),
      select: {
        id: true,
        name: true,
        kind: true,
        institutionId: true,
        teachers: { where: { id: user.id }, select: { id: true } },
        noteSets: {
          where: { active: true },
          select: {
            deadline: true,
            questions: {
              where: { active: true },
              select: { id: true, required: true },
            },
          },
        },
        children: { select: { id: true, ...presenceSelect(today) } },
      },
      orderBy: { name: 'asc' },
    });
    if (!groups.length) return [];
    const entries = await this.calendar.entriesBetween(today, today);
    const candidates = groups
      .filter((group) => dayInfo(today, group, entries).working)
      .map((group) => ({
        group,
        sets: group.noteSets.filter((set) => set.questions.length > 0),
        expected: group.children
          .filter((child) => !isAbsent(today, true, child))
          .map((child) => child.id),
      }))
      .filter((c) => c.sets.length > 0 && c.expected.length > 0);
    if (!candidates.length) return [];
    const answers = await this.prisma.noteAnswer.findMany({
      where: {
        childId: { in: candidates.flatMap((c) => c.expected) },
        date: today,
        voidedAt: null,
      },
      select: { childId: true, questionId: true },
    });
    const answered = answeredMap(answers);
    const rows: PendingNotesRow[] = candidates.map((c) => ({
      group: { id: c.group.id, name: c.group.name },
      own: c.group.teachers.some((t) => t.id === user.id),
      ...pendingForGroup(c.sets, c.expected, answered, today, now),
    }));
    return rows
      .filter((row) => row.pending > 0)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue));
  }

  async parentNotes(
    parentId: string,
    childId: string,
    fromValue?: string,
    toValue?: string,
    now: Date = new Date(),
  ) {
    const to = toValue ? parseDay(toValue) : kyivToday(now);
    const from = fromValue ? parseDay(fromValue) : addDays(to, -6);
    if (time(to) < time(from)) throw new BadRequestException('Invalid period');
    if (dayCount(from, to) > MAX_DAYS)
      throw new BadRequestException('Period too long');
    await assertOwnChild(this.prisma, parentId, childId);
    const answers = await this.prisma.noteAnswer.findMany({
      where: { childId, date: { gte: from, lte: to }, voidedAt: null },
      select: {
        date: true,
        questionText: true,
        questionType: true,
        unit: true,
        valueText: true,
        valueBool: true,
        valueNumber: true,
        question: { select: { set: { select: { id: true, name: true } } } },
      },
      orderBy: [
        { date: 'desc' },
        { question: { set: { name: 'asc' } } },
        { question: { sortOrder: 'asc' } },
      ],
    });
    type DayView = {
      date: string;
      sets: {
        id: string;
        name: string;
        answers: {
          question: string;
          type: NoteQuestionType;
          value: string | number | boolean | null;
          unit: string | null;
        }[];
      }[];
    };
    const days: DayView[] = [];
    for (const a of answers) {
      const date = isoDay(a.date);
      let day = days.find((d) => d.date === date);
      if (!day) {
        day = { date, sets: [] };
        days.push(day);
      }
      const setRef = a.question.set;
      let set = day.sets.find((s) => s.id === setRef.id);
      if (!set) {
        set = { id: setRef.id, name: setRef.name, answers: [] };
        day.sets.push(set);
      }
      set.answers.push({
        question: a.questionText,
        type: a.questionType,
        value: answerValue(a),
        unit: a.unit,
      });
    }
    return {
      days: days.map((day) => ({
        date: day.date,
        sets: day.sets.map((set) => ({ name: set.name, answers: set.answers })),
      })),
    };
  }
}
