# Percent assessment in daily notes design

## Intent

Teachers in the kindergarten and the mini-school already rate children every day inside daily notes: questions like «Музичне заняття», «LEGO», «Навчальні заняття (ЯДС, Математика, Укр.мова)» are `choice` questions with options «20%», «50%», «100%». For the system these are just text labels, so nothing can be summed up. The customer wants, at the end of a semester, each child's percentage per activity, and for the school also the level the child reached (Високий / Достатній / Середній / Початковий), in a report.

Success: the admin opens Reports → «Оцінювання», picks the semester and a group, and sees for every child and every rated activity the average percent and, for the school, the level; the same table downloads as Excel. Teachers keep filling notes exactly as now.

## Goals

- A new note question type **percent**: the admin defines the allowed values (e.g. 20 / 50 / 100); the teacher picks one, like a choice; the answer is stored as a number.
- Existing choice questions whose options are all of the form `N%` become percent questions automatically, with their past answers converted, so nothing is re-entered.
- Each institution can have its own **level scale**: an ordered list of levels with a name, a short code and a lower bound in percent. The school sets it up (the customer sent two variants of bounds, so bounds are not fixed in code). The kindergarten has no scale and gets percent only.
- A new report **«Оцінювання»**: per child and percent question over a period, the number of rated days, the average percent and the level from the child's institution scale.

## Non-goals

- No separate assessment page: rating stays in daily notes.
- No changes to school lessons (timetable lesson marks, НУШ levels on a lesson stay as they are).
- No stored semester results, no "close semester" step: the report is computed live for the chosen period.
- No semester entity or calendar setup.
- Parents do not see levels or averages; they keep seeing daily answers (now shown as «50%») in the cabinet notes.

## Anti-goals

- Past answers parents already saw must not change meaning: a converted «50%» still reads «50%».
- Days without an answer must not pull the average down.
- Filling notes must not get slower or look different for the teacher.

## Decisions (from the conversation)

- Rating happens in daily notes, every day, in percent (screenshots: kindergarten activities and the mini-school question «Навчальні заняття (ЯДС, Математика, Укр.мова)» with 20% / 50% / 100%).
- At the end of the semester the percentages are summed up into one percent per activity; the school additionally gets a level from that percent, the kindergarten gets percent only.
- The school approves its own scale. Example from the customer: Високий (В) 85–100% (or 90–100%), Достатній (Д) 65–84% (or 70–89%), Середній (С) 40–64% (or 40–69%), Початковий (П) below 40%.
- Levels appear only in the report.

## Calls made by me (not discussed, may be changed)

- **"Summed" means the average:** average of the child's active answers for that question over the period, rounded to a whole percent (half up). Days without an answer are skipped. Rated days are shown next to it so a 100% from 2 days is visible as such.
- **Percent options:** 2–10 distinct whole numbers 0–100, stored in `options` as strings (`"20"`, `"50"`, `"100"`), shown with `%`. `min`, `max`, `unit` are not allowed for this type. The answer must be one of the options; stored in `valueNumber` (`valueText` and `valueBool` null). The client sends the number.
- **Conversion migration:** in one SQL migration, every `NoteQuestion` with type `choice` whose every option matches `^\s*\d{1,3}\s*%\s*$` with a value ≤ 100 becomes `percent` with options stripped to the number. `NoteAnswer` rows of those questions (active and voided) whose `valueText` matches the same pattern get `questionType = percent`, `valueNumber = N`, `valueText = null`; rows that do not match (an option removed long ago) stay `choice` text answers and are ignored by the report.
- **Level scale storage:** new model `AssessmentLevel { id, institutionId, name (1–50), code (1–5), minPercent (0–100 int), createdAt, updatedAt }`, unique `(institutionId, minPercent)`. The level of a percent is the level with the highest `minPercent` ≤ percent. If no level matches (scale without a 0 bound and a lower percent), or the institution has no levels, the level is empty. Order is by `minPercent` descending, no separate sort field.
- **Scale API:** `GET /institutions/:id/assessment-levels` and `PUT /institutions/:id/assessment-levels` (replaces the whole list; body `{ levels: [{ name, code, minPercent }] }`, 0–10 levels, distinct `minPercent`). Read: anyone who can see the institution. Write: same rule as editing the institution (root, or `settings: edit` with scope `all`). Audited like other writes.
- **Scale UI:** in the institution edit modal (`pages/institutions`), a block «Шкала рівнів» with rows name / code / «від, %», add and remove rows, saved with the institution. A button «Заповнити типовою шкалою» fills В 85, Д 65, С 40, П 0.
- **Report «Оцінювання»** (`key: assessment`, file name `оцінювання`, permission area `register`, period required, filters institution, kind, group, child): one row per child × question with at least one active percent answer in the period. Columns: Дитина, Група, Заклад, Питання (current question text), Днів з оцінкою, Середній %, Рівень (name and code, empty without a scale). The child's institution is the institution of the group the answer was given in; the group column is that group (a child who changed groups mid-period gets a row per group). Rows sorted by group, child, question set order, question order. Scope rules are the same as the attendance report. No totals row.
- **Semester presets** in the report period filter, computed on the client from today: «I семестр» = 1 Sep – 31 Dec, «II семестр» = 1 Jan – 31 May of the current school year (school year starts 1 Sep).
- **Notes UI:** the question editor gets the type «Відсоток» with a list of numeric values (default 20, 50, 100); the fill screen and the parent cabinet render percent like choice buttons / text, with a `%` suffix. Completeness, deadlines, dashboard and reminders treat percent exactly like choice.

## Setup after release (admin, no code)

- Mini-school note set: deactivate the sleep questions; replace the combined question «Навчальні заняття (ЯДС, Математика, Укр.мова)» with one percent question per subject (ЯДС, Математика, Українська мова, ...), then deactivate the combined one. Each subject then gets its own average and level in the report. Old answers of the combined question stay in history and appear in the report as their own row for periods that include them.
- School institution: fill the level scale.

## What is left to the builder

- Exact Prisma model and migration names, DTO shapes beyond the ones above, error strings (add Ukrainian translations in the frontend `errorMessages.ts`).
- Layout details of the scale block and the report table (follow existing report and modal patterns).
