# UX Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 58 findings of the 2026-10-29 UX audit across backend and frontend.

**Architecture:** Backend first (validation hardening, one-call user creation, read-only legacy subscriptions, a slim users lookup endpoint, three small response fields), then frontend by module, each task consuming the new API. Every finding in the spec's "Findings" section maps to exactly one task below by its section.

**Tech Stack:** NestJS 11 + Prisma 7 + Jest (backend); React 19 + MUI 9 + Zustand + react-hook-form/yup (frontend).

**Spec:** `docs/superpowers/specs/2026-10-29-ux-audit-fixes-design.md` (backend repo). The "Decisions" section overrides a finding's "Suggested fix" where they differ.

## Global Constraints

- Backend `D:\IT\backend-edu-nest`, frontend `D:\IT\EduNest`; both branch `main`, commit directly, don't push. Read each repo's `CLAUDE.md` first.
- Backend: new/changed service methods get unit tests (mocked Prisma); verify with `npx jest <paths>`, `npx eslint <changed files>` (not `npm run lint`), `npm run build`, full `npx jest` once per task. Error messages in English, exact strings from the spec. No comments, no new deps, no migrations needed (if one turns out necessary, stop and report). API changes must be added to the backend `CLAUDE.md` Frontend section.
- Frontend: `npm run build` clean, `npm run lint` ≤ baseline 7 problems. Keep each file's code style; don't reformat. Keep the phone layout (CardList, `fullScreen={isPhone}`) working for every touched page. New Ukrainian error translations in `src/shared/api/errorMessages.ts` for every new backend message.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One task = one commit per repo (a task touching both repos = one commit in each).

## Review Focus

- A finding in a task's sections left unaddressed (reviewer checks the section list one by one).
- Backend validation that breaks updating an existing record whose stored value is now inactive (must stay valid when unchanged).
- Options filtered so hard that the currently selected (stored) value disappears from an edit form.
- Lookup endpoint leaking data to parents or to staff without any listed area.
- Phone layout regressions in touched dialogs/pages.

---

### Task 1: Backend validation hardening

**Spec sections:** finance #1 (packages purchase), finance #3 second half (future `receivedAt`), finance #12 backend part (inactive subscription type — superseded by Task 2), classes GroupModal tariffs/teachers backend parts, groups teachers/bell schedule backend parts, children parents backend part, payroll terms inactive teacher (reject inactive teacher on new terms).

**Files:** `src/classes/packages.service.ts`, `src/classes/class-groups.service.ts`, `src/groups/groups.service.ts`, `src/children/children.service.ts`, `src/finance/payments.service.ts`, `src/payroll/salary-terms.service.ts` + their `*.spec.ts`; backend `CLAUDE.md`.

- [ ] Failing tests per rule (each: rejected when inactive/mismatched; accepted when an already stored inactive value is unchanged on update), then implement, then commit `fix: reject inactive and mismatched references`.

### Task 2: Backend user creation, legacy subscriptions, lookup, small fields

**Spec sections:** users "Create user dialog" (backend part), subscriptions #12 (backend part), groups "Groups page needs users:view", routine CopyRoutineDialog (`hasTemplate`), payroll ExtraHoursDialog (`extraHourRate` on the card), classes "both tariffs optional" (`hasSingleTariff` in the roster), reports "Вчитель" (teachers for payroll-only users via lookup).

**Files:** `src/users/*` (DTO, service, controller, new `GET /users/lookup` before `:id` routes), `src/subscriptions/subscriptions.service.ts`, `src/routine/routine.service.ts`, `src/payroll/*` (card view), `src/classes/lessons.service.ts` (roster) + specs; backend `CLAUDE.md` (API changes).

- [ ] Tests first, implement, commit `feat: add user lookup and one-call staff creation`.

### Task 3: Frontend finance, tariffs, subscriptions

**Spec sections:** finance #2–#11, #12 UI part (hide «Створити» on subscriptions), #13 only if create stays (it doesn't → skip, note it), tariffs #10–#11.

**Files:** `src/pages/finance/**`, `src/pages/tariffs/**`, `src/pages/subscriptions/**`, `src/shared/api/*` as needed, `errorMessages.ts`.

- [ ] Implement, build + lint, commit `fix: smarter finance and tariff forms`.

### Task 4: Frontend classes, register, calendar, timetable, routine

**Spec sections:** all of "Audit: classes / register / timetable / routine" (classes, classGroup, register, calendar, schedule, scheduleSetup, routine), using Task 2's lookup for teachers, `hasSingleTariff`, `hasTemplate`.

**Files:** `src/pages/classes/**`, `classGroup/**`, `register/**`, `calendar/**`, `schedule/**`, `scheduleSetup/**`, `routine/**`, `src/shared/api/*`.

- [ ] Implement, build + lint, commit `fix: filter options and add shortcuts in classes and schedules`.

### Task 5: Frontend meals, payroll, reports

**Spec sections:** all of "Audit: meals, payroll, reports…" (meals ×4, payroll ×5 incl. prefilled new terms version and payment amount, reports ×3), using Task 2's `extraHourRate` and lookup.

**Files:** `src/pages/meals/**`, `payroll/**`, `reports/**`, `src/shared/api/*`.

- [ ] Implement, build + lint, commit `fix: prefill payroll forms and narrow meals and report options`.

### Task 6: Frontend users, structure, parent cabinet, auth pages

**Spec sections:** all of "Audit: users, positions, institutions, groups, children, parent cabinet, auth pages" incl. shared `ConfirmDialog` for every immediate delete in the app (grep all pages for delete handlers called directly), one-call user creation, lookup endpoint for teachers/parents, parent meals and paying flows per the Decisions.

**Files:** `src/shared/ui/ConfirmDialog.tsx` (new), `src/pages/users/**`, `groups/**`, `children/**`, `institutions/**`, `widgets/childForms/**`, `widgets/groupForms/**`, `family/**`, `familyChild/**`, `login/**`, `profile/**`, `shared/ui/PasswordFields.tsx`, other pages' delete buttons; frontend `CLAUDE.md` (ConfirmDialog, lookup).

- [ ] Implement, build + lint, commit `fix: confirm deletes and streamline users and parent flows`.
