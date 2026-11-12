# Percent Assessment in Daily Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily-note questions of a new type `percent`, an institution level scale, and a report «Оцінювання» with average percent and level per child and question.

**Architecture:** Backend (`D:\IT\backend-edu-nest`, NestJS 11 + Prisma 7): new enum value + data conversion migration, pure helpers in `notes-calc.ts` / `assessment-levels.ts` / `reports-calc.ts` with Jest specs, thin service/controller wiring. Frontend (`D:\IT\EduNest`, React 19 + MUI 9): question editor/fill/parent rendering, scale block in the institution edit modal, report definition and semester presets.

**Tech Stack:** NestJS, Prisma 7 (CLI needs Node 22: prepend `/c/Users/Nazarii/AppData/Local/nvm/v22.22.2` to PATH), Jest; React, MUI 9, Zustand, react-hook-form + yup.

**Spec:** `docs/superpowers/specs/2026-11-12-note-percent-assessment-design.md`

## Global Constraints

- Percent options: 2–10 distinct whole numbers 0–100, stored as strings without `%` (`"20"`), shown with `%`; `min`, `max`, `unit` forbidden for percent.
- Percent answer stored in `valueNumber` (`toFixed(2)`), `valueText`/`valueBool` null; must equal one of the options.
- Average = mean of active percent answers in the period, rounded to whole percent half up; days without answer skipped.
- Level = level with the highest `minPercent` ≤ average; none matches or no scale → empty.
- Scale: 0–10 levels, `name` 1–50, `code` 1–5, `minPercent` int 0–100, distinct per institution. Write rights = editing the institution (root, or `settings: edit` + full scope).
- Default scale button: В 85, Д 65, С 40, П 0 (names «Високий», «Достатній», «Середній», «Початковий»).
- Report key `assessment`, title «Оцінювання», file name `оцінювання`, area `register: view`, period required, filters institution/kind/group/child, no totals row.
- Semester presets: «I семестр» 1 Sep–31 Dec, «II семестр» 1 Jan–31 May of the current school year (starts 1 Sep).
- Backend messages in English, Ukrainian translations in frontend `shared/api/errorMessages.ts`. No code comments. Conventional Commits, one task = one commit, co-author line. No push.
- Lessons (timetable НУШ levels) are not touched.

## Review Focus

1. Option `0` and all-zero answers → average 0% → level with `minPercent` 0 (not "empty" by falsy check). Test in Task 2 and Task 3.
2. Legacy choice options with spaces (`"50 %"`, `" 100%"`) are converted; options like `"Добре"` or `"150%"` keep the question as choice. Test via the SQL preview in Task 1.
3. A child who answered in two groups in the period gets one row per group, each with its own institution's level. Test in Task 3.
4. A deactivated question with answers in the period still appears in the report. Test in Task 3 (rows built from answers, not from active questions).
5. Re-saving an unchanged percent answer must not create a voided duplicate (`sameValue` compares `valueNumber` via `toFixed(2)`). Test in Task 1.

---

### Task 1: Backend percent question type

**Files:**
- Modify: `prisma/schema.prisma` (enum `NoteQuestionType` + `percent`)
- Create: `prisma/migrations/20261112130000_note_percent_type/migration.sql` (only `ALTER TYPE "NoteQuestionType" ADD VALUE 'percent';`)
- Create: `prisma/migrations/20261112130100_note_percent_convert/migration.sql` (data conversion; separate migration because a new enum value cannot be used in the transaction that adds it)
- Modify: `src/daily-notes/notes-calc.ts`, `src/daily-notes/note-sets.service.ts:118-138`, `src/daily-notes/daily-notes.service.ts:85-90`
- Test: `src/daily-notes/notes-calc.spec.ts`, `src/daily-notes/daily-notes.service.spec.ts`

**Interfaces:**
- Produces: `NoteQuestionType.percent`; `validateQuestion` / `normalizeAnswer` accept it; API returns percent answers as `number`.

- [ ] **Step 1: Failing tests in `notes-calc.spec.ts`**

```ts
describe('percent questions', () => {
  const q = { type: NoteQuestionType.percent, options: ['20', '50', '100'], min: null, max: null };
  it('accepts valid options', () => expect(validateQuestion({ text: 'LEGO', type: 'percent', options: ['0', '50', '100'] })).toBeNull());
  it('rejects fewer than 2', () => expect(validateQuestion({ text: 'x', type: 'percent', options: ['50'] })).toBe('Percent needs 2 to 10 options'));
  it('rejects non-integers and >100', () => {
    expect(validateQuestion({ text: 'x', type: 'percent', options: ['20', '50%'] })).toBe('Invalid percent option');
    expect(validateQuestion({ text: 'x', type: 'percent', options: ['20', '101'] })).toBe('Invalid percent option');
  });
  it('rejects duplicates', () => expect(validateQuestion({ text: 'x', type: 'percent', options: ['20', '020'] })).toBe('Duplicate option'));
  it('rejects unit and bounds', () => expect(validateQuestion({ text: 'x', type: 'percent', options: ['0', '100'], unit: '%' })).toBe('Unit and range are not allowed for percent'));
  it('stores a number answer', () => expect(normalizeAnswer(q, 50)).toEqual({ clear: false, value: { valueText: null, valueBool: null, valueNumber: '50.00' } }));
  it('accepts a numeric string', () => expect(normalizeAnswer(q, '100')).toMatchObject({ value: { valueNumber: '100.00' } }));
  it('rejects a value outside options', () => expect(normalizeAnswer(q, 30)).toEqual({ error: 'Invalid answer' }));
  it('clears on null', () => expect(normalizeAnswer(q, null)).toEqual({ clear: true }));
});
```

Also in `daily-notes.service.spec.ts`: saving the same percent value twice does not void the stored answer (Review Focus 5), and the day view returns `value: 50` (number) for a percent answer.

- [ ] **Step 2:** `npx jest src/daily-notes` → new tests FAIL.

- [ ] **Step 3: Implement**
  - schema enum value; migration 1 as above.
  - `validateQuestion`: for `percent`, options required (2–10), each trimmed must match `/^\d{1,3}$/` and be ≤ 100 (`'Invalid percent option'`), duplicates compared by `Number(o)` (`'Duplicate option'`); `unit`, `min`, `max` must be null/undefined/empty (`'Unit and range are not allowed for percent'`). The non-choice "Options are only for choice questions" check must exclude percent.
  - `normalizeAnswer` `case 'percent'`: raw number or trimmed numeric string → `Number`; must satisfy `q.options.map(Number).includes(value)`; returns `valueNumber: value.toFixed(2)`.
  - `normalizeQuestion`: percent options stored as `String(Number(o.trim()))`, `min/max/unit` null.
  - `answerValue`: `percent` returns `valueNumber.toNumber()` like `number`.
  - `NoteQuestionDto` needs no change (`IsEnum` picks the new value).

- [ ] **Step 4: Migration 2 SQL**

```sql
WITH q AS (
  SELECT id FROM "NoteQuestion"
  WHERE type = 'choice'
    AND cardinality(options) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM unnest(options) o
      WHERE o !~ '^\s*\d{1,3}\s*%\s*$'
         OR regexp_replace(o, '\D', '', 'g')::int > 100
    )
)
UPDATE "NoteQuestion" nq
SET type = 'percent',
    options = ARRAY(SELECT (regexp_replace(o, '\D', '', 'g')::int)::text FROM unnest(nq.options) WITH ORDINALITY AS t(o, i) ORDER BY i)
FROM q WHERE nq.id = q.id;

UPDATE "NoteAnswer" a
SET "questionType" = 'percent',
    "valueNumber" = regexp_replace(a."valueText", '\D', '', 'g')::int,
    "valueText" = NULL
FROM "NoteQuestion" nq
WHERE a."questionId" = nq.id
  AND nq.type = 'percent'
  AND a."questionType" = 'choice'
  AND a."valueText" ~ '^\s*\d{1,3}\s*%\s*$'
  AND regexp_replace(a."valueText", '\D', '', 'g')::int <= 100;
```

  Verify on local Docker Postgres (`docker compose up -d` in the backend; if Docker is off, ask the user to start it): seed one choice question `['20%',' 50 %','100%']` with answers `'50 %'` and one `['Добре','Погано']`; run `npx prisma migrate dev` (Node 22); check the first became percent with options `{20,50,100}` and answer `valueNumber 50`, the second stayed choice (Review Focus 2).

- [ ] **Step 5:** `npx jest src/daily-notes` PASS; `npm run build`; `npx eslint src/daily-notes`.

- [ ] **Step 6: Commit** `feat: add percent note question type`

---

### Task 2: Backend institution level scale

**Files:**
- Modify: `prisma/schema.prisma` (model `AssessmentLevel`, relation `Institution.assessmentLevels`)
- Create: `prisma/migrations/20261112130200_assessment_levels/migration.sql` (generate with `npx prisma migrate diff --from-schema <old> --to-schema prisma/schema.prisma --script`)
- Create: `src/institutions/assessment-levels.ts`, `src/institutions/assessment-levels.spec.ts`, `src/institutions/dto/assessment-levels.dto.ts`
- Modify: `src/institutions/institutions.controller.ts`, `src/institutions/institutions.service.ts`, `src/institutions/institutions.service.spec.ts`

**Interfaces:**
- Produces:
  - `type LevelInput = { name: string; code: string; minPercent: number }`
  - `validateLevels(levels: LevelInput[]): string | null`
  - `levelFor(levels: { name: string; code: string; minPercent: number }[], percent: number): { name: string; code: string } | null`
  - `GET /institutions/:id/assessment-levels` → `{ name, code, minPercent }[]` sorted by `minPercent` desc
  - `PUT /institutions/:id/assessment-levels` body `{ levels: LevelInput[] }` → same list

- [ ] **Step 1: Failing tests `assessment-levels.spec.ts`**

```ts
const scale = [
  { name: 'Високий', code: 'В', minPercent: 85 },
  { name: 'Достатній', code: 'Д', minPercent: 65 },
  { name: 'Середній', code: 'С', minPercent: 40 },
  { name: 'Початковий', code: 'П', minPercent: 0 },
];
it('picks the highest bound not above the percent', () => {
  expect(levelFor(scale, 84)).toEqual({ name: 'Достатній', code: 'Д' });
  expect(levelFor(scale, 85)).toEqual({ name: 'Високий', code: 'В' });
  expect(levelFor(scale, 0)).toEqual({ name: 'Початковий', code: 'П' });
});
it('returns null below the lowest bound or without a scale', () => {
  expect(levelFor(scale.slice(0, 3), 39)).toBeNull();
  expect(levelFor([], 70)).toBeNull();
});
it('validates', () => {
  expect(validateLevels(scale)).toBeNull();
  expect(validateLevels([])).toBeNull();
  expect(validateLevels([...scale, { name: 'X', code: 'X', minPercent: 85 }])).toBe('Duplicate level bound');
  expect(validateLevels([{ name: '', code: 'В', minPercent: 10 }])).toBe('Invalid level');
  expect(validateLevels([{ name: 'A', code: 'ABCDEF', minPercent: 10 }])).toBe('Invalid level');
  expect(validateLevels([{ name: 'A', code: 'A', minPercent: 101 }])).toBe('Invalid level');
  expect(validateLevels(Array.from({ length: 11 }, (_, i) => ({ name: `L${i}`, code: `${i}`, minPercent: i })))).toBe('Too many levels');
});
```

Service spec: PUT by a user without full scope → 403 `Outside access scope`; PUT on unknown id → 404 `Institution not found` (reuse the existing message in the service); PUT replaces (deleteMany + createMany in one transaction, names/codes trimmed) and records an audit change (`recordChange`, as `update` does); GET for a user without the institution in scope → 403.

- [ ] **Step 2:** `npx jest src/institutions` → FAIL.

- [ ] **Step 3: Implement** model `AssessmentLevel { id uuid, institutionId, institution (onDelete Cascade), name, code, minPercent Int, createdAt, updatedAt, @@unique([institutionId, minPercent]) }`; helpers; DTO (`levels` array, `ValidateNested`, `IsString`, `IsInt`); controller: `@Get(':id/assessment-levels')` (no permission decorator, service checks: staff only, institution in scope), `@Permission(settings, edit) @Put(':id/assessment-levels')`; service `getLevels(id, user)`, `setLevels(id, dto, user)` with `assertFullScope`.

- [ ] **Step 4:** `npx jest src/institutions` PASS; `npm run build`; eslint on changed files.

- [ ] **Step 5:** Commit `feat: add institution assessment level scale`

---

### Task 3: Backend report «Оцінювання»

**Files:**
- Modify: `src/reports/reports-calc.ts`, `src/reports/activity-reports.service.ts`, `src/reports/reports.controller.ts`, `CLAUDE.md` (reports + notes sections: percent type, scale, report)
- Test: `src/reports/reports-calc.spec.ts`, `src/reports/activity-reports.service.spec.ts`

**Interfaces:**
- Consumes: `levelFor` (Task 2), `NoteQuestionType.percent` (Task 1).
- Produces:
  - `interface AssessmentAnswerRow { child: string; group: string; institution: string; institutionId: string; questionId: string; question: string; setName: string; sortOrder: number; percent: number }`
  - `assessmentReport(period: PeriodRef, answers: AssessmentAnswerRow[], levels: Map<string, { name: string; code: string; minPercent: number }[]>): Report`
  - `GET /reports/assessment` (`register: view`), same query and xlsx handling as `attendance`.

- [ ] **Step 1: Failing tests in `reports-calc.spec.ts`**

```ts
describe('assessmentReport', () => {
  const base = { child: 'Іваненко Олег', group: 'Сонечко', institution: 'Школа', institutionId: 's', questionId: 'q1', question: 'Математика', setName: 'Щоденні', sortOrder: 0 };
  const levels = new Map([['s', [{ name: 'Достатній', code: 'Д', minPercent: 65 }, { name: 'Початковий', code: 'П', minPercent: 0 }]]]);
  it('averages, rounds half up and applies the level', () => {
    const r = assessmentReport(period, [{ ...base, percent: 100 }, { ...base, percent: 50 }, { ...base, percent: 50 }], levels);
    expect(r.rows).toEqual([{ child: 'Іваненко Олег', group: 'Сонечко', institution: 'Школа', question: 'Математика', days: 3, average: 0.67, level: 'Достатній (Д)' }]);
  });
  it('gives the zero-bound level to 0%', () => {
    expect(assessmentReport(period, [{ ...base, percent: 0 }], levels).rows[0].level).toBe('Початковий (П)');
  });
  it('leaves the level empty without a scale', () => {
    expect(assessmentReport(period, [{ ...base, institutionId: 'k', percent: 50 }], levels).rows[0].level).toBeNull();
  });
  it('splits a child by group', () => {
    const rows = assessmentReport(period, [{ ...base, percent: 50 }, { ...base, group: 'Зірочка', percent: 100 }], levels).rows;
    expect(rows.map((r) => [r.group, r.average])).toEqual([['Зірочка', 1], ['Сонечко', 0.5]]);
  });
});
```

Also: columns are `child` «Дитина» text, `group` «Група» text, `institution` «Заклад» text, `question` «Питання» text, `days` «Днів з оцінкою» number, `average` «Середній %» percent, `level` «Рівень» text; `title` «Оцінювання», `fileName` «оцінювання», `totals: null`, `sheets: []`. Rows sorted by group, child, setName, sortOrder, question. Rounding: whole percent `Math.round(sum / count)` (66.67 → 67), level from that whole percent, cell `average = whole / 100` (0.67). Grouping key: group + child + questionId (so a renamed question stays one row; label is the current question text).

Service spec: queries `noteAnswer.findMany` with `voidedAt: null`, `questionType: 'percent'`, `date` in period, `group: groupFilterWhere(filter)` plus `groupId`/`childId` when given, and no filter on `question.active` (Review Focus 4); loads `assessmentLevel.findMany({ where: { institutionId: { in } } })` for the institutions found.

- [ ] **Step 2:** `npx jest src/reports` → FAIL.

- [ ] **Step 3: Implement** `assessmentReport`; `ActivityReportsService.assessment(query, user)` (select child names, group `name`/`institutionId`/`institution.name`, question `id`/`text`/`sortOrder`/`set.name`, `valueNumber.toNumber()`); controller route `@Get('assessment') @Permission(register, view)` mirroring `attendance`.

- [ ] **Step 4:** `npx jest` (whole backend) PASS; `npm run build`; eslint on changed files. Update backend `CLAUDE.md`.

- [ ] **Step 5:** Commit `feat: add assessment report`

---

### Task 4: Frontend percent questions in notes

**Files:**
- Modify: `src/shared/api/dailyNotes.ts` (type + label `percent: 'Відсоток'`), `src/pages/notes/ui/NoteSetDialog.tsx`, `src/pages/notes/model/notesStore.ts:32,47`, `src/pages/notes/ui/FillTab.tsx:39`, `src/pages/familyChild/ui/NotesTab.tsx:18`, `src/shared/api/errorMessages.ts`

**Interfaces:**
- Consumes: Task 1 API (percent value is a `number`, options are numeric strings).

- [ ] **Step 1: Implement**
  - Editor: type «Відсоток» shows an options list like choice, but each input is a number 0–100 with `%` adornment; switching a question to percent pre-fills `['20','50','100']` when it has no options; yup/inline validation mirrors the backend rules (2–10, whole 0–100, distinct) with Ukrainian messages; unit/min/max fields hidden for percent.
  - Fill: percent renders the same toggle buttons as choice with labels `${o}%`, value sent as `Number(o)`; store treats percent like choice but with number values (compare/clear the same way).
  - Parent tab: a number answer of `questionType === 'percent'` renders `${value}%`.
  - Translations: `'Percent needs 2 to 10 options'` → «Для відсотка потрібно від 2 до 10 варіантів», `'Invalid percent option'` → «Варіант відсотка: ціле число від 0 до 100», `'Unit and range are not allowed for percent'` → «Для відсотка не можна задавати одиницю чи межі».

- [ ] **Step 2:** `npm run build` + `npm run lint` → 0 errors (6 old warnings).

- [ ] **Step 3:** Commit `feat: add percent questions to daily notes`

---

### Task 5: Frontend level scale in the institution modal

**Files:**
- Modify: `src/shared/api/institutions.ts` (`AssessmentLevel { name; code; minPercent }`, `institutionsApi.getLevels(id)`, `institutionsApi.setLevels(id, levels)`), `src/shared/api/index.ts`, `src/pages/institutions/ui/EditInstitutionModal.tsx`, `src/pages/institutions/model/institutionsStore.ts`, `src/shared/api/errorMessages.ts`, `src/shared/api/audit.ts` (`routeLabels['PUT /institutions/:id/assessment-levels'] = 'Змінено шкалу рівнів'`)

**Interfaces:**
- Consumes: Task 2 endpoints.

- [ ] **Step 1: Implement**
  - Modal loads levels on open; block «Шкала рівнів» below the existing fields: rows (Назва, Код, «від, %») with delete icon, «Додати рівень», «Заповнити типовою шкалою» (replaces rows with В/Д/С/П 85/65/40/0), hint «Без шкали у звіті буде лише відсоток». Rows via `useFieldArray` in the same form; yup: name 1–50, code 1–5, minPercent int 0–100, distinct bounds («Межі рівнів не можуть повторюватись»), max 10.
  - Save: `updateInstitution` first, then `setLevels` only if rows changed; modal stays open on failure. Phone: rows stack (`flexDirection: { xs: 'column', sm: 'row' }`).
  - Translations: `'Duplicate level bound'` → «Межі рівнів не можуть повторюватись», `'Invalid level'` → «Перевірте назву, код і межу рівня», `'Too many levels'` → «Не більше 10 рівнів».

- [ ] **Step 2:** `npm run build` + `npm run lint`.

- [ ] **Step 3:** Commit `feat: edit institution level scale`

---

### Task 6: Frontend report «Оцінювання» and semester presets

**Files:**
- Modify: `src/shared/api/reports.ts` (`ReportKey` + definition `{ key: 'assessment', fileName: 'оцінювання', label: 'Оцінювання', areas: ['register'], period: true, filters: ['institution', 'kind', 'group', 'child'] }`), `src/pages/reports/ui/ReportFilters.tsx` (presets), `CLAUDE.md` (Reports, Daily notes, Institutions paragraphs)

**Interfaces:**
- Consumes: Task 3 endpoint; `formatCell` already formats `percent` fractions.

- [ ] **Step 1: Implement** presets after «Цей місяць»: school year start `y = month >= 8 (Sep, 0-based) ? year : year - 1`; «I семестр» `${y}-09-01`–`${y}-12-31`; «II семестр» `${y+1}-01-01`–`${y+1}-05-31` (built with `dayString(Date.UTC(...))` like the others). Check the report page renders an empty level cell as blank.

- [ ] **Step 2:** `npm run build` + `npm run lint`. Manual check with backend on port 3100 (not 3000): create a percent question, fill two days, set a scale, open the report for «I семестр».

- [ ] **Step 3:** Commit `feat: add assessment report and semester presets`
