import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, NoteQuestionType, Prisma } from '@prisma/client';
import { baseScope, scopeIds } from '../access/access-calc';
import { assertInstitutionInScope } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { findInstitution } from '../institutions/institution-checks';
import { parseTime } from '../meals/meals-calc';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoteSetDto } from './dto/create-note-set.dto';
import { NoteQuestionDto } from './dto/note-question.dto';
import { UpdateNoteSetDto } from './dto/update-note-set.dto';
import { validateQuestion } from './notes-calc';

const MAX_QUESTIONS = 30;
const DEFAULT_DEADLINE = '17:00';
const SET_FIELDS = [
  'name',
  'deadline',
  'active',
  'groups',
  'questions',
] as const;

const setSelect = {
  select: {
    id: true,
    name: true,
    deadline: true,
    active: true,
    institution: { select: { id: true, name: true } },
    groups: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
    questions: {
      select: {
        id: true,
        text: true,
        type: true,
        required: true,
        options: true,
        min: true,
        max: true,
        unit: true,
        active: true,
        sortOrder: true,
        _count: { select: { answers: true } },
      },
      orderBy: { sortOrder: 'asc' },
    },
  },
} satisfies Prisma.NoteSetDefaultArgs;

type LoadedSet = Prisma.NoteSetGetPayload<typeof setSelect>;
type Tx = Prisma.TransactionClient;

type QuestionData = {
  text: string;
  type: NoteQuestionType;
  required: boolean;
  options: string[];
  min: number | null;
  max: number | null;
  unit: string | null;
  sortOrder: number;
};

const toNumber = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : value.toNumber();

const toView = (set: LoadedSet) => ({
  id: set.id,
  name: set.name,
  deadline: set.deadline,
  active: set.active,
  institution: set.institution,
  groups: set.groups,
  questions: set.questions.map((q) => ({
    id: q.id,
    text: q.text,
    type: q.type,
    required: q.required,
    options: q.options,
    min: toNumber(q.min),
    max: toNumber(q.max),
    unit: q.unit,
    active: q.active,
    sortOrder: q.sortOrder,
    answered: q._count.answers > 0,
  })),
});

const setAudit = (set: LoadedSet) => {
  const active = set.questions.filter((q) => q.active);
  return {
    name: set.name,
    deadline: set.deadline,
    active: set.active,
    groups: set.groups.map((g) => g.id).sort(),
    questions: { count: active.length, texts: active.map((q) => q.text) },
  };
};

const checkDeadline = (deadline: string): string => {
  if (parseTime(deadline) === null)
    throw new BadRequestException('Invalid deadline');
  return deadline;
};

const onlyDeactivates = (dto: UpdateNoteSetDto): boolean => {
  const sent = Object.entries(dto).filter(([, value]) => value !== undefined);
  return sent.length === 1 && sent[0][0] === 'active' && sent[0][1] === false;
};

const normalizeQuestion = (
  q: NoteQuestionDto,
  sortOrder: number,
): QuestionData => {
  const error = validateQuestion(q);
  if (error) throw new BadRequestException(error);
  const isNumber = q.type === NoteQuestionType.number;
  const isPercent = q.type === NoteQuestionType.percent;
  const unit = q.unit?.trim();
  return {
    text: q.text.trim(),
    type: q.type,
    required: q.required ?? false,
    options: isPercent
      ? (q.options ?? []).map((o) => String(Number(o.trim())))
      : q.type === NoteQuestionType.choice
        ? (q.options ?? []).map((o) => o.trim())
        : [],
    min: isNumber ? (q.min ?? null) : null,
    max: isNumber ? (q.max ?? null) : null,
    unit: unit && !isPercent ? unit : null,
    sortOrder,
  };
};

const normalizeQuestions = (questions: NoteQuestionDto[]) => {
  if (questions.length > MAX_QUESTIONS)
    throw new BadRequestException('Too many questions');
  const ids = questions.flatMap((q) => (q.id ? [q.id] : []));
  if (new Set(ids).size !== ids.length)
    throw new BadRequestException('Duplicate question');
  return questions.map((q, index) => ({
    id: q.id,
    data: normalizeQuestion(q, index),
  }));
};

@Injectable()
export class NoteSetsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async assertNameFree(
    tx: Tx,
    institutionId: string,
    name: string,
    exceptId?: string,
  ) {
    const existing = await tx.noteSet.findFirst({
      where: {
        institutionId,
        name,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Note set name already taken');
  }

  private async assertGroups(
    tx: Tx,
    institutionId: string,
    groupIds: string[],
  ) {
    if (groupIds.length === 0) return;
    const groups = await tx.group.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, institutionId: true },
    });
    if (groups.length !== groupIds.length)
      throw new NotFoundException('Group not found');
    if (groups.some((g) => g.institutionId !== institutionId))
      throw new BadRequestException('Group belongs to another institution');
  }

  private async lockSet(tx: Tx, id: string, actor: AuthenticatedUser) {
    await tx.$queryRaw`SELECT id FROM "NoteSet" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.noteSet.findUnique({
      where: { id },
      ...setSelect,
    });
    const scope = scopeIds(actor);
    if (!current || (scope && !scope.includes(current.institution.id)))
      throw new NotFoundException('Note set not found');
    assertInstitutionInScope(baseScope(actor), current.institution.id);
    return current;
  }

  private async writeUnique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Note set name already taken');
      throw error;
    }
  }

  async list(actor: AuthenticatedUser) {
    const scope = scopeIds(actor);
    const rows = await this.prisma.noteSet.findMany({
      where: scope ? { institutionId: { in: scope } } : {},
      orderBy: [{ institution: { name: 'asc' } }, { name: 'asc' }],
      ...setSelect,
    });
    return rows.map(toView);
  }

  async create(dto: CreateNoteSetDto, actor: AuthenticatedUser) {
    assertInstitutionInScope(baseScope(actor), dto.institutionId);
    const deadline = checkDeadline(dto.deadline ?? DEFAULT_DEADLINE);
    const questions = normalizeQuestions(dto.questions);
    const groupIds = [...new Set(dto.groupIds)];
    return this.writeUnique(() =>
      this.prisma.$transaction(async (tx) => {
        await findInstitution(tx, dto.institutionId, { active: true });
        await this.assertGroups(tx, dto.institutionId, groupIds);
        await this.assertNameFree(tx, dto.institutionId, dto.name);
        const created = await tx.noteSet.create({
          data: {
            institutionId: dto.institutionId,
            name: dto.name,
            deadline,
            groups: { connect: groupIds.map((id) => ({ id })) },
            questions: { create: questions.map((q) => q.data) },
          },
          ...setSelect,
        });
        await this.audit.recordChange(tx, {
          actorId: actor.id,
          entityType: 'note-sets',
          entityId: created.id,
          action: AuditAction.create,
          before: null,
          after: setAudit(created),
          fields: SET_FIELDS,
        });
        return toView(created);
      }),
    );
  }

  async update(id: string, dto: UpdateNoteSetDto, actor: AuthenticatedUser) {
    const deadline =
      dto.deadline === undefined ? undefined : checkDeadline(dto.deadline);
    const questions = dto.questions
      ? normalizeQuestions(dto.questions)
      : undefined;
    const groupIds = dto.groupIds ? [...new Set(dto.groupIds)] : undefined;
    return this.writeUnique(() =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockSet(tx, id, actor);
        const institutionId = current.institution.id;
        if (!onlyDeactivates(dto))
          await findInstitution(tx, institutionId, { active: true });
        if (dto.name !== undefined && dto.name !== current.name)
          await this.assertNameFree(tx, institutionId, dto.name, id);
        if (groupIds) await this.assertGroups(tx, institutionId, groupIds);
        if (questions) await this.replaceQuestions(tx, current, questions);
        const updated = await tx.noteSet.update({
          where: { id },
          data: {
            name: dto.name,
            deadline,
            active: dto.active,
            ...(groupIds
              ? { groups: { set: groupIds.map((g) => ({ id: g })) } }
              : {}),
          },
          ...setSelect,
        });
        await this.audit.recordChange(tx, {
          actorId: actor.id,
          entityType: 'note-sets',
          entityId: id,
          action: AuditAction.update,
          before: setAudit(current),
          after: setAudit(updated),
          fields: SET_FIELDS,
        });
        return toView(updated);
      }),
    );
  }

  private async replaceQuestions(
    tx: Tx,
    current: LoadedSet,
    questions: { id?: string; data: QuestionData }[],
  ) {
    const existing = new Map(current.questions.map((q) => [q.id, q]));
    for (const q of questions) {
      if (!q.id) continue;
      const row = existing.get(q.id);
      if (!row) throw new NotFoundException('Question not found');
      if (row._count.answers > 0 && row.type !== q.data.type)
        throw new BadRequestException('Question type cannot change');
    }
    const kept = new Set(questions.flatMap((q) => (q.id ? [q.id] : [])));
    const omitted = current.questions.filter((q) => !kept.has(q.id));
    const unused = omitted.filter((q) => q._count.answers === 0);
    const answered = omitted.filter((q) => q._count.answers > 0);
    if (unused.length > 0)
      await tx.noteQuestion.deleteMany({
        where: { id: { in: unused.map((q) => q.id) } },
      });
    for (const [index, q] of answered.entries()) {
      await tx.noteQuestion.update({
        where: { id: q.id },
        data: { active: false, sortOrder: questions.length + index },
      });
    }
    for (const q of questions) {
      if (q.id)
        await tx.noteQuestion.update({
          where: { id: q.id },
          data: { ...q.data, active: true },
        });
      else
        await tx.noteQuestion.create({
          data: { setId: current.id, ...q.data },
        });
    }
  }

  async remove(id: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockSet(tx, id, actor);
      if (current.questions.some((q) => q._count.answers > 0))
        throw new BadRequestException('Note set is in use');
      await tx.noteSet.delete({ where: { id } });
      await this.audit.recordChange(tx, {
        actorId: actor.id,
        entityType: 'note-sets',
        entityId: id,
        action: AuditAction.delete,
        before: setAudit(current),
        after: null,
        fields: SET_FIELDS,
      });
      return { message: 'Note set deleted' };
    });
  }
}
