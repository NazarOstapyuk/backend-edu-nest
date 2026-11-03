import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  AuditAction,
  InstitutionType,
  NoteQuestionType,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { NoteQuestionDto } from './dto/note-question.dto';
import { NoteSetsService } from './note-sets.service';

const mockPrisma = {
  noteSet: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  noteQuestion: {
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  group: { findMany: jest.fn() },
  institution: { findUnique: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockAudit = { recordChange: jest.fn() };

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  positionId: 'p1',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [],
  scopeInstitutionIds: null,
  permissions: { register: PermissionLevel.edit },
  ...over,
});

const admin = user();
const scoped = user({
  accessScope: AccessScope.institutions,
  institutionIds: ['i1'],
  scopeInstitutionIds: ['i1'],
});

const institution = {
  id: 'i1',
  name: 'Садок',
  type: InstitutionType.kindergarten,
  isActive: true,
};

type QuestionRow = {
  id: string;
  text: string;
  type: NoteQuestionType;
  required: boolean;
  options: string[];
  min: Prisma.Decimal | null;
  max: Prisma.Decimal | null;
  unit: string | null;
  active: boolean;
  sortOrder: number;
  _count: { answers: number };
};

const question = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: 'q1',
  text: 'Настрій',
  type: NoteQuestionType.text,
  required: false,
  options: [],
  min: null,
  max: null,
  unit: null,
  active: true,
  sortOrder: 0,
  _count: { answers: 0 },
  ...over,
});

const setRow = (questions: QuestionRow[] = [question()]) => ({
  id: 's1',
  name: 'Обід',
  deadline: '17:00',
  active: true,
  institution: { id: 'i1', name: 'Садок' },
  groups: [{ id: 'g1', name: 'Сонечко' }],
  questions,
});

const choice: NoteQuestionDto = {
  text: '  Скільки з’їв  ',
  type: NoteQuestionType.choice,
  required: true,
  options: [' 0% ', '50%', '100%'],
  min: 1,
  max: 2,
  unit: '  ',
};

describe('NoteSetsService', () => {
  let service: NoteSetsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NoteSetsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = moduleRef.get(NoteSetsService);
    mockPrisma.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.institution.findUnique.mockResolvedValue(institution);
    mockPrisma.group.findMany.mockResolvedValue([
      { id: 'g1', institutionId: 'i1' },
    ]);
    mockPrisma.noteSet.findFirst.mockResolvedValue(null);
    mockPrisma.noteSet.findUnique.mockResolvedValue(setRow());
    mockPrisma.noteSet.create.mockResolvedValue(setRow());
    mockPrisma.noteSet.update.mockResolvedValue(setRow());
  });

  describe('list', () => {
    it('filters by the effective scope and orders by institution then name', async () => {
      mockPrisma.noteSet.findMany.mockResolvedValue([
        setRow([
          question({
            type: NoteQuestionType.number,
            min: new Prisma.Decimal('1.5'),
            max: new Prisma.Decimal(10),
            unit: 'год',
            _count: { answers: 3 },
          }),
        ]),
      ]);
      const result = await service.list(scoped);
      expect(mockPrisma.noteSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { institutionId: { in: ['i1'] } },
          orderBy: [{ institution: { name: 'asc' } }, { name: 'asc' }],
        }),
      );
      expect(result).toEqual([
        {
          id: 's1',
          name: 'Обід',
          deadline: '17:00',
          active: true,
          institution: { id: 'i1', name: 'Садок' },
          groups: [{ id: 'g1', name: 'Сонечко' }],
          questions: [
            {
              id: 'q1',
              text: 'Настрій',
              type: NoteQuestionType.number,
              required: false,
              options: [],
              min: 1.5,
              max: 10,
              unit: 'год',
              active: true,
              sortOrder: 0,
              answered: true,
            },
          ],
        },
      ]);
    });

    it('lists everything without a scope', async () => {
      mockPrisma.noteSet.findMany.mockResolvedValue([]);
      await service.list(admin);
      expect(mockPrisma.noteSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('create', () => {
    const dto = () => ({
      institutionId: 'i1',
      name: 'Обід',
      groupIds: ['g1', 'g1'],
      questions: [
        choice,
        { text: 'Сон', type: NoteQuestionType.yes_no, min: 1, options: [] },
      ],
    });

    it('creates a set with trimmed questions in array order and records the change', async () => {
      await expect(service.create(dto(), admin)).resolves.toMatchObject({
        id: 's1',
      });
      expect(mockPrisma.noteSet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            institutionId: 'i1',
            name: 'Обід',
            deadline: '17:00',
            groups: { connect: [{ id: 'g1' }] },
            questions: {
              create: [
                {
                  text: 'Скільки з’їв',
                  type: NoteQuestionType.choice,
                  required: true,
                  options: ['0%', '50%', '100%'],
                  min: null,
                  max: null,
                  unit: null,
                  sortOrder: 0,
                },
                {
                  text: 'Сон',
                  type: NoteQuestionType.yes_no,
                  required: false,
                  options: [],
                  min: null,
                  max: null,
                  unit: null,
                  sortOrder: 1,
                },
              ],
            },
          },
        }),
      );
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'note-sets',
          entityId: 's1',
          action: AuditAction.create,
          before: null,
          after: {
            name: 'Обід',
            deadline: '17:00',
            active: true,
            groups: ['g1'],
            questions: { count: 1, texts: ['Настрій'] },
          },
        }),
      );
    });

    it('keeps min and max for number questions', async () => {
      await service.create(
        {
          ...dto(),
          deadline: '12:30',
          questions: [
            {
              text: 'Сон',
              type: NoteQuestionType.number,
              min: 0,
              max: 3.5,
              unit: ' год ',
            },
          ],
        },
        admin,
      );
      const [[{ data }]] = mockPrisma.noteSet.create.mock.calls as [
        [
          {
            data: {
              deadline: string;
              questions: { create: Record<string, unknown>[] };
            };
          },
        ],
      ];
      expect(data.deadline).toBe('12:30');
      expect(data.questions.create[0]).toMatchObject({
        min: 0,
        max: 3.5,
        unit: 'год',
      });
    });

    it('rejects an institution outside the granted scope', async () => {
      await expect(
        service.create({ ...dto(), institutionId: 'i2' }, scoped),
      ).rejects.toThrow(new ForbiddenException('Outside access scope'));
      expect(mockPrisma.noteSet.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive institution', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        ...institution,
        isActive: false,
      });
      await expect(service.create(dto(), admin)).rejects.toThrow(
        new BadRequestException('Institution is inactive'),
      );
    });

    it('rejects a group of another institution', async () => {
      mockPrisma.group.findMany.mockResolvedValue([
        { id: 'g1', institutionId: 'i2' },
      ]);
      await expect(service.create(dto(), admin)).rejects.toThrow(
        new BadRequestException('Group belongs to another institution'),
      );
    });

    it('rejects an unknown group', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await expect(service.create(dto(), admin)).rejects.toThrow(
        new NotFoundException('Group not found'),
      );
    });

    it('rejects a bad deadline', async () => {
      await expect(
        service.create({ ...dto(), deadline: '25:00' }, admin),
      ).rejects.toThrow(new BadRequestException('Invalid deadline'));
    });

    it('rejects more than 30 questions', async () => {
      const questions = Array.from({ length: 31 }, (_, i) => ({
        text: `Q${i}`,
        type: NoteQuestionType.text,
      }));
      await expect(
        service.create({ ...dto(), questions }, admin),
      ).rejects.toThrow(new BadRequestException('Too many questions'));
    });

    it('rejects an invalid question with the validateQuestion message', async () => {
      await expect(
        service.create(
          {
            ...dto(),
            questions: [
              { text: 'X', type: NoteQuestionType.choice, options: ['a'] },
            ],
          },
          admin,
        ),
      ).rejects.toThrow(
        new BadRequestException('Choice needs 2 to 10 options'),
      );
    });

    it('rejects a taken name', async () => {
      mockPrisma.noteSet.findFirst.mockResolvedValue({ id: 's2' });
      await expect(service.create(dto(), admin)).rejects.toThrow(
        new ConflictException('Note set name already taken'),
      );
    });

    it('maps a unique violation to 409', async () => {
      mockPrisma.noteSet.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(service.create(dto(), admin)).rejects.toThrow(
        new ConflictException('Note set name already taken'),
      );
    });
  });

  describe('update', () => {
    it('locks the set row before reading it', async () => {
      await service.update('s1', { active: false }, admin);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.noteSet.findUnique.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.noteSet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({ active: false }) as object,
        }),
      );
    });

    it('answers 404 for a set outside the effective scope', async () => {
      mockPrisma.noteSet.findUnique.mockResolvedValue({
        ...setRow(),
        institution: { id: 'i2', name: 'Школа' },
      });
      await expect(service.update('s1', { name: 'X' }, scoped)).rejects.toThrow(
        new NotFoundException('Note set not found'),
      );
    });

    it('answers 404 for a missing set', async () => {
      mockPrisma.noteSet.findUnique.mockResolvedValue(null);
      await expect(service.update('s1', {}, admin)).rejects.toThrow(
        new NotFoundException('Note set not found'),
      );
    });

    it('rejects a rename to a taken name', async () => {
      mockPrisma.noteSet.findFirst.mockResolvedValue({ id: 's2' });
      await expect(
        service.update('s1', { name: 'Сон' }, admin),
      ).rejects.toThrow(new ConflictException('Note set name already taken'));
      expect(mockPrisma.noteSet.findFirst).toHaveBeenCalledWith({
        where: { institutionId: 'i1', name: 'Сон', id: { not: 's1' } },
        select: { id: true },
      });
    });

    it('replaces groups', async () => {
      mockPrisma.group.findMany.mockResolvedValue([
        { id: 'g2', institutionId: 'i1' },
      ]);
      await service.update('s1', { groupIds: ['g2'] }, admin);
      expect(mockPrisma.noteSet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            groups: { set: [{ id: 'g2' }] },
          }) as object,
        }),
      );
    });

    it('deactivates an omitted answered question and deletes an unanswered one', async () => {
      mockPrisma.noteSet.findUnique.mockResolvedValue(
        setRow([
          question({ id: 'q1', _count: { answers: 2 } }),
          question({ id: 'q2', sortOrder: 1 }),
          question({ id: 'q3', sortOrder: 2 }),
        ]),
      );
      await service.update(
        's1',
        {
          questions: [
            { id: 'q3', text: ' Сон ', type: NoteQuestionType.text },
            { text: 'Нове', type: NoteQuestionType.yes_no },
          ],
        },
        admin,
      );
      expect(mockPrisma.noteQuestion.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['q2'] } },
      });
      expect(mockPrisma.noteQuestion.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: { active: false, sortOrder: 2 },
      });
      expect(mockPrisma.noteQuestion.update).toHaveBeenCalledWith({
        where: { id: 'q3' },
        data: {
          text: 'Сон',
          type: NoteQuestionType.text,
          required: false,
          options: [],
          min: null,
          max: null,
          unit: null,
          sortOrder: 0,
          active: true,
        },
      });
      expect(mockPrisma.noteQuestion.create).toHaveBeenCalledWith({
        data: {
          setId: 's1',
          text: 'Нове',
          type: NoteQuestionType.yes_no,
          required: false,
          options: [],
          min: null,
          max: null,
          unit: null,
          sortOrder: 1,
        },
      });
    });

    it('reactivates an inactive question sent by id', async () => {
      mockPrisma.noteSet.findUnique.mockResolvedValue(
        setRow([question({ active: false, _count: { answers: 1 } })]),
      );
      await service.update(
        's1',
        { questions: [{ id: 'q1', text: 'Настрій', type: 'text' }] },
        admin,
      );
      expect(mockPrisma.noteQuestion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1' },
          data: expect.objectContaining({ active: true }) as object,
        }),
      );
      expect(mockPrisma.noteQuestion.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects a type change of an answered question', async () => {
      mockPrisma.noteSet.findUnique.mockResolvedValue(
        setRow([question({ _count: { answers: 1 } })]),
      );
      await expect(
        service.update(
          's1',
          {
            questions: [
              { id: 'q1', text: 'Настрій', type: NoteQuestionType.yes_no },
            ],
          },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Question type cannot change'));
      expect(mockPrisma.noteSet.update).not.toHaveBeenCalled();
    });

    it('allows a type change of an unanswered question', async () => {
      await service.update(
        's1',
        {
          questions: [
            { id: 'q1', text: 'Настрій', type: NoteQuestionType.yes_no },
          ],
        },
        admin,
      );
      expect(mockPrisma.noteQuestion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NoteQuestionType.yes_no,
          }) as object,
        }),
      );
    });

    it('rejects a question id of another set', async () => {
      await expect(
        service.update(
          's1',
          {
            questions: [
              { id: 'qx', text: 'Настрій', type: NoteQuestionType.text },
            ],
          },
          admin,
        ),
      ).rejects.toThrow(new NotFoundException('Question not found'));
    });

    it('rejects the same question id twice', async () => {
      const q = { id: 'q1', text: 'Настрій', type: NoteQuestionType.text };
      await expect(
        service.update('s1', { questions: [q, q] }, admin),
      ).rejects.toThrow(new BadRequestException('Duplicate question'));
    });

    it('records the change', async () => {
      mockPrisma.noteSet.update.mockResolvedValue({
        ...setRow(),
        name: 'Сон',
      });
      await service.update('s1', { name: 'Сон' }, admin);
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'note-sets',
          action: AuditAction.update,
          before: expect.objectContaining({ name: 'Обід' }) as object,
          after: expect.objectContaining({ name: 'Сон' }) as object,
        }),
      );
    });
  });

  describe('remove', () => {
    it('deletes an unused set', async () => {
      await expect(service.remove('s1', admin)).resolves.toEqual({
        message: 'Note set deleted',
      });
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.noteSet.findUnique.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.noteSet.delete).toHaveBeenCalledWith({
        where: { id: 's1' },
      });
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'note-sets',
          action: AuditAction.delete,
          after: null,
        }),
      );
    });

    it('refuses a set with answers', async () => {
      mockPrisma.noteSet.findUnique.mockResolvedValue(
        setRow([question({ active: false, _count: { answers: 1 } })]),
      );
      await expect(service.remove('s1', admin)).rejects.toThrow(
        new BadRequestException('Note set is in use'),
      );
      expect(mockPrisma.noteSet.delete).not.toHaveBeenCalled();
    });

    it('answers 404 outside the scope', async () => {
      mockPrisma.noteSet.findUnique.mockResolvedValue({
        ...setRow(),
        institution: { id: 'i2', name: 'Школа' },
      });
      await expect(service.remove('s1', scoped)).rejects.toThrow(
        new NotFoundException('Note set not found'),
      );
    });
  });
});
