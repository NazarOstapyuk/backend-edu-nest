import { NoteQuestionType } from '@prisma/client';
import { deadlineFor } from '../meals/meals-calc';

export type QuestionInput = {
  text: string;
  type: NoteQuestionType;
  required?: boolean;
  options?: string[];
  min?: number | null;
  max?: number | null;
  unit?: string | null;
};

export type AnswerValue = {
  valueText: string | null;
  valueBool: boolean | null;
  valueNumber: string | null;
};

export type PendingSet = {
  deadline: string;
  questions: { id: string; required: boolean }[];
};

const NUMBER_LIMIT = 99999999.99;
const NUMBER_PATTERN = /^-?\d{1,8}(\.\d{1,2})?$/;

const hasTwoDecimals = (value: number): boolean =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

const validBound = (value: number | null | undefined): boolean =>
  value === null ||
  value === undefined ||
  (Number.isFinite(value) &&
    Math.abs(value) <= NUMBER_LIMIT &&
    hasTwoDecimals(value));

export function validateQuestion(q: QuestionInput): string | null {
  const text = q.text.trim();
  if (text.length < 1 || text.length > 300) return 'Invalid question text';

  const options = q.options ?? [];
  if (q.type !== 'choice') {
    if (options.length > 0) return 'Options are only for choice questions';
  } else {
    if (options.length < 2 || options.length > 10) {
      return 'Choice needs 2 to 10 options';
    }
    const seen = new Set<string>();
    for (const option of options) {
      const trimmed = option.trim();
      if (trimmed.length < 1 || trimmed.length > 50) return 'Invalid option';
      if (seen.has(trimmed)) return 'Duplicate option';
      seen.add(trimmed);
    }
  }

  if (!validBound(q.min) || !validBound(q.max)) return 'Invalid range';
  if (
    q.min !== null &&
    q.min !== undefined &&
    q.max !== null &&
    q.max !== undefined &&
    q.min > q.max
  ) {
    return 'Invalid range';
  }

  if (q.unit !== null && q.unit !== undefined && q.unit.trim().length > 20) {
    return 'Invalid unit';
  }
  return null;
}

const INVALID = { error: 'Invalid answer' as const };

const answer = (value: Partial<AnswerValue>) => ({
  clear: false as const,
  value: { valueText: null, valueBool: null, valueNumber: null, ...value },
});

export function normalizeAnswer(
  q: {
    type: NoteQuestionType;
    options: string[];
    min: string | null;
    max: string | null;
  },
  raw: unknown,
):
  | { clear: true }
  | { clear: false; value: AnswerValue }
  | { error: 'Invalid answer' } {
  if (raw === null || raw === undefined) return { clear: true };
  if (typeof raw === 'string' && raw.trim() === '') return { clear: true };

  switch (q.type) {
    case 'choice':
      if (typeof raw !== 'string' || !q.options.includes(raw)) return INVALID;
      return answer({ valueText: raw });
    case 'text': {
      if (typeof raw !== 'string') return INVALID;
      const text = raw.trim();
      if (text.length > 1000) return INVALID;
      return answer({ valueText: text });
    }
    case 'yes_no':
      if (typeof raw !== 'boolean') return INVALID;
      return answer({ valueBool: raw });
    case 'number': {
      let value: number;
      if (typeof raw === 'number') {
        if (
          !Number.isFinite(raw) ||
          Math.abs(raw) > NUMBER_LIMIT ||
          !hasTwoDecimals(raw)
        ) {
          return INVALID;
        }
        value = raw;
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!NUMBER_PATTERN.test(trimmed)) return INVALID;
        value = Number(trimmed);
      } else {
        return INVALID;
      }
      if (q.min !== null && value < Number(q.min)) return INVALID;
      if (q.max !== null && value > Number(q.max)) return INVALID;
      return answer({ valueNumber: value.toFixed(2) });
    }
    default:
      return INVALID;
  }
}

export function isComplete(
  questions: { id: string; required: boolean }[],
  answeredIds: Set<string>,
): boolean {
  if (questions.length === 0) return true;
  const required = questions.filter((question) => question.required);
  if (required.length === 0) {
    return questions.some((question) => answeredIds.has(question.id));
  }
  return required.every((question) => answeredIds.has(question.id));
}

export function pendingForGroup(
  sets: PendingSet[],
  expectedChildIds: string[],
  answered: Map<string, Set<string>>,
  date: Date,
  now: Date,
): { pending: number; overdue: boolean } {
  const empty = new Set<string>();
  const pendingChildren = new Set<string>();
  let overdue = false;
  for (const set of sets) {
    const past = now.getTime() >= deadlineFor(date, set.deadline).getTime();
    for (const childId of expectedChildIds) {
      if (!isComplete(set.questions, answered.get(childId) ?? empty)) {
        pendingChildren.add(childId);
        if (past) overdue = true;
      }
    }
  }
  return { pending: pendingChildren.size, overdue };
}
