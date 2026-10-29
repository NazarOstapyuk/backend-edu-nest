# UX audit fixes — design

## Intent

A read-only audit (2026-10-29) of every page found 58 places where users enter the same thing twice, pick from options that do not fit the context, get dead-end errors, or where the backend accepts inconsistent data. The user asked to fix all of them at once. The audit findings below (verbatim, grouped by area) are the requirements; this header records the decisions taken where a finding offered options.

Repos: backend `D:\IT\backend-edu-nest`, frontend `D:\IT\EduNest`. Desktop and mobile layouts from the mobile work must keep working (phone cards, fullScreen dialogs).

## Decisions (my calls; the user approved fixing everything without choosing per item)

- **Packages purchase (backend):** require an active direction, an active class group of that direction whose `packageTariffId` equals the tariff, and the child in the actor's scope (`assertChildInScope`, 404 `Child not found` outside). New error `Tariff is not a package of this direction` (400).
- **Inactive options are rejected by the backend too:** class group teachers and group teachers (`isActive`), class group tariffs (`isActive`), bell schedule on a group (`active`), child parents (`isActive`). Existing error strings are reused where they exist; new ones: `Teacher is inactive`, `Tariff is not active` (already exists), `Bell schedule is inactive`, `Parent is inactive`. Current values that are already stored stay valid on update when unchanged.
- **Payments:** `receivedAt` after Kyiv today → 400 `Date is in the future` (string already used in payroll).
- **Create user in one call:** `POST /users` accepts optional `accessScope` + `institutionIds` for staff with the same rules as `PATCH /users/:id/access` (scope check, active institutions), applied in the same transaction; the frontend drops the second call.
- **Legacy subscriptions:** creating is disabled: `POST /subscriptions` → 400 `Subscriptions are read-only`; the UI hides «Створити». Editing/cancelling existing ones stays.
- **Lookup endpoint:** `GET /users/lookup?role=teacher|parent` → `[{ id, firstName, lastName, middleName, phone, isActive, institutionIds }]`, guarded by `@PermissionAny([users, children, classes, timetable, payroll, finance, register], view)` (staff only; parents 403); only active users unless `includeInactive=true`. Groups/children/institutions pages, class groups, timetable, payroll and report filters use it instead of `GET /users`.
- **Small API additions:** `GET /routine/groups` items gain `hasTemplate: boolean`; the payroll card `GET /payroll/:teacherId/:month` gains `extraHourRate` (money string | null, from the terms valid at month end, or the latest in the month); the class-group lesson roster gains `hasSingleTariff: boolean`.
- **Delete confirmation:** one shared `ConfirmDialog` in `shared/ui` used by every delete button (users, children, groups, institutions, and any other immediate delete found).
- **Payment allocation:** the create-payment form runs the allocation suggestion automatically (debounced) once amount and category are valid; the user can still edit or clear it.
- **Parent meals:** preselect the only complex; drop the separate «Замовити» checkbox in favour of choosing a complex (a «Не замовляти» option unticks); add «Як у першому дні» that copies the first chosen day's complex and dishes to the other open days where the same complex/dishes are available.
- **Parent paying:** family page child card gets «Оплатити» when due > 0 (opens the child page on the Фінанси tab); a family with one child opens that child directly; the child page opens on Фінанси when due > 0 and no tab is requested.
- **Teacher pickers:** active teachers only; in group forms also only teachers whose scope covers the group's institution.
- **Everything else:** apply the "Suggested fix" of each finding as written (frontend only unless it says backend).

## Non-goals

- No redesign, no new dependencies, no change to money calculations.
- Error message strings that exist stay as they are.

## Findings (verbatim from the audit)


### Audit: Finance / tariffs / subscriptions audit

Frontend root: D:\IT\EduNest\src\pages. Backend root: D:\IT\backend-edu-nest\src.

#### finance

### 1. Buy package: backend accepts any direction + tariff pair, inactive direction, any child
- **Page / form**: BuyPackageModal (finance/ui/BuyPackageModal.tsx:498-501); backend classes/packages.service.ts:111-163
- **Problem**: UI now derives the pair from `ClassGroup.packageTariffId`, but `POST /children/:id/packages` only checks that direction and tariff exist, tariff is a package and active. It does not check that the tariff belongs to a group of that direction, nor `direction.isActive`. It also never checks the child is inside the caller's institution scope (no `assertChildInScope` anywhere in packages.service/controller).
- **Why it matters**: the original "direction A with direction B's tariff" combo is still creatable via API, and a scoped admin can sell a package to a child of another institution (wrong data and access leak).
- **Suggested fix**: backend: in `purchase` require an active direction, a class group of that direction with `packageTariffId = tariffId`, and `assertChildInScope`.
- **Severity**: high

### 2. Create payment: allocation is manual, easy to leave money unallocated
- **Page / form**: CreatePaymentModal (finance/ui/CreatePaymentModal.tsx:217-232, 349); backend finance/payments.service.ts:48
- **Problem**: the user must press "Запропонувати розподіл" after entering amount and category. If they just press "Зберегти", the payment is stored with zero allocations (backend allocates only when `allocations` is sent), so the charges stay overdue.
- **Why it matters**: the frequent flow "cash received, close the oldest debt" needs an extra click; forgetting it leaves a debt showing next to an unallocated payment and requires a second dialog (AllocateModal).
- **Suggested fix**: frontend: auto-run the suggestion (debounced) when amount/category become valid, or when the form is submitted with empty allocations; no backend change.
- **Severity**: medium

### 3. Create payment: category not defaulted from child's debt; future date allowed
- **Page / form**: CreatePaymentModal (CreatePaymentModal.tsx:190-198, 317-339); backend payments.service.ts:43
- **Problem**: "Призначення" defaults to "Без категорії" even when the child has a debt in exactly one category (the page already has `finance.categories`). `receivedAt` accepts a future date with no validation on either side.
- **Why it matters**: uncategorised payment covers any charge, so meals/extra charges get eaten silently; a mistyped future date distorts reports.
- **Suggested fix**: preselect the only category with debt; reject `receivedAt` after Kyiv today in the schema and in `payments.service` (backend change for the second part).
- **Severity**: low

### 4. Enrollment / adaptation tariff select not filtered by the child's institution
- **Page / form**: CreateEnrollmentModal (finance/ui/CreateEnrollmentModal.tsx:34, 66-72), CreateAdaptationVisitModal (finance/ui/CreateAdaptationVisitModal.tsx:340, 379-384); stores enrollmentsStore / adaptationStore call `tariffsApi.getList()`
- **Problem**: options are all active month/hour tariffs visible under the header institution, not the child's group institution. A user with scope "all" and no selected institution sees tariffs of every institution.
- **Why it matters**: user can pick a tariff of another institution; backend rejects with `Tariff belongs to another institution` (enrollments.service.ts:133, adaptation.service.ts:89), so no bad data but a wasted attempt and an English-translated error.
- **Suggested fix**: frontend: filter `t.institutionId === null || t.institutionId === child.group.institution.id`; auto-select when only one option remains.
- **Severity**: medium

### 5. Enrollment form: start date empty, no defaults
- **Page / form**: CreateEnrollmentModal (CreateEnrollmentModal.tsx:25, 76-91)
- **Problem**: `startDate` has no default (user types it every time); tariff is not auto-selected when only one monthly tariff exists. The tariff's default billing mode is shown only as "Як у тарифі" without saying what that is.
- **Why it matters**: double work on the most common child-onboarding flow.
- **Suggested fix**: default `startDate` to today (or first of next month), auto-select the single tariff, show the tariff's mode in the "Як у тарифі" item.
- **Severity**: medium

### 6. Adjustment / end enrollment / extend package: date fields empty
- **Page / form**: AdjustmentModal (AdjustmentModal.tsx:181, `startDate: ''`), EndEnrollmentModal (EndEnrollmentModal.tsx:339 `endDate: ''`), ExtendPackageModal (ExtendPackageModal.tsx:25 `newExpiresAt: ''`)
- **Problem**: required date fields start empty although a sensible default exists (today for adjustment start / enrollment end; current expiry for extend).
- **Why it matters**: extra typing; for Extend the user must compute from the shown "Поточний термін".
- **Suggested fix**: prefill with today / current expiry; backend already validates new expiry is later (packages.service.ts:178).
- **Severity**: low

### 7. Adjustment: percent/amount value has no context
- **Page / form**: AdjustmentModal (AdjustmentModal.tsx:229-243)
- **Problem**: the user types an absolute price for `custom_price` or a discount amount with no display of the enrollment's current tariff price. Label for `custom_price` and `discount_amount` is the same "Сума, грн".
- **Why it matters**: easy to enter a discount where a full price was meant (wrong charge).
- **Suggested fix**: label per type ("Нова ціна" vs "Знижка, грн") and show current price in helper text.
- **Severity**: low

### 8. Payment link: category and amount defaults ignore the debt
- **Page / form**: PaymentLinkModal (finance/ui/PaymentLinkModal.tsx:220-221)
- **Problem**: category defaults to `financeCategories[0]` (tuition) and amount to that category's debt; if the debt is in another category the user gets an empty amount and must switch category.
- **Why it matters**: wrong category link sent to parent is possible when tuition debt is 0.
- **Suggested fix**: default to the category with the largest debt.
- **Severity**: low

### 9. Manual charge: period fields and category default
- **Page / form**: CreateChargeModal (finance/ui/CreateChargeModal.tsx:41, 91-122)
- **Problem**: category defaults to `tuition`; period dates optional and empty, one can be filled without the other.
- **Why it matters**: charges without a period are excluded/mislabeled in period reports and overdue logic (verify per cabinet-calc); low risk.
- **Suggested fix**: default period to the current month or require both dates together.
- **Severity**: low

#### tariffs

### 10. Create tariff: billing mode shown for all units, meaningless for non-month
- **Page / form**: CreateTariffModal (tariffs/ui/CreateTariffModal.tsx:184-201, default `calendar_full`); backend tariffs.service.ts:156 stores it for any unit
- **Problem**: "Режим періоду за замовчуванням" is asked even for session / hour / package tariffs where it has no effect (billing engine only runs for month).
- **Why it matters**: confusing mandatory field, stores garbage that blocks nothing but misleads the tariff card (TariffModal.tsx shows it for every unit).
- **Suggested fix**: show only when `unit === 'month'`; hide in TariffModal for other units.
- **Severity**: medium

### 11. Create tariff: "Діє з" empty and category/unit combos unconstrained
- **Page / form**: CreateTariffModal (CreateTariffModal.tsx:54-64, 142-164); TariffModal price form (TariffModal.tsx priceSchema)
- **Problem**: `effectiveFrom` has no default (today) in create and in "add price"; category and unit are independent, so e.g. a package tariff in category `meals` or `tuition` unit `session` is accepted.
- **Why it matters**: package/session tariffs produce charges in whichever category was picked; wrong category means payments of another category do not cover them.
- **Suggested fix**: default `effectiveFrom` to today; warn or restrict categories for package/hour units (backend accepts all, no change required).
- **Severity**: low

#### subscriptions (legacy, read-only per CLAUDE.md but still creatable)

### 12. Create subscription still available; inactive types and children offered
- **Page / form**: CreateSubscriptionModal (subscriptions/ui/CreateSubscriptionModal.tsx:70-77, 86-92); backend subscriptions/subscriptions.service.ts:12-19
- **Problem**: the type Autocomplete lists all types including `isActive = false`; the backend only checks existence (no `isActive` check). Children list is unfiltered (no scope/inactive filter in the select; backend loads children without scope check). The old module is documented as legacy but the create flow is fully open and bypasses finance (no Charge is created).
- **Why it matters**: new subscriptions bypass the ledger/packages model; inactive types and out-of-scope children can be used.
- **Suggested fix**: hide the "create" action (or backend reject) for the legacy module; otherwise filter `isActive` in UI and add the check in `create`.
- **Severity**: high (new legacy data outside finance) / medium if module is intentionally kept

### 13. Create subscription: sessions count not derived
- **Page / form**: CreateSubscriptionModal (CreateSubscriptionModal.tsx:36, 109-124)
- **Problem**: `totalSessions` starts empty and there is no preview of the total price (`pricePerSession * totalSessions`).
- **Why it matters**: minor double work, no price confirmation.
- **Suggested fix**: show the computed total under the field.
- **Severity**: low

#### Checked, no issues
- AllocateModal (auto-loads suggestion on open, validates against remaining).
- EditSubscriptionModal (only totalSessions; backend enforces not below used).
- subscriptionTypes create/edit modals (name + price only).
- Void/Reconcile flows: reason required is justified; ReconcileModal partial amount validated against total.
- Online payment links: backend validates amount range and online enabled.
- Enrollment overlap on the same tariff is rejected by backend (enrollments.service.ts:160-172); end-before-start rejected.

### Audit: Audit: classes / register / timetable / routine

Frontend root: D:\IT\EduNest\src\pages. Backend root: D:\IT\backend-edu-nest\src.

#### classes (GroupModal, ClassesPage)

- **Page / form**: classes/ui/GroupModal.tsx:25-27, 115-136 (tariff selects), store classes/model/classesStore.ts (fetchAll)
  - **Problem**: «Тариф разового заняття» / «Тариф пакета» list every tariff of that unit, including institution-specific ones and inactive ones. Backend `assertTariff` (classes/class-groups.service.ts:40-51) rejects any tariff with `institutionId` (400 `Tariff belongs to another institution`), so the user picks a valid-looking option and gets an error on save. Inactive tariffs are accepted silently (no isActive check); `PackagesService.purchase` later refuses inactive ones (`Tariff is not active`), so the group's package becomes non-purchasable.
  - **Why it matters**: dead-end choices; a group can end up pointing at an inactive package tariff.
  - **Suggested fix**: filter options to `institutionId === null && isActive` (keep the current value visible); optionally add the isActive check in `assertTariff` (backend).
  - **Severity**: medium

- **Page / form**: classes/ui/GroupModal.tsx:106-116 (teacher Autocomplete), classesStore.ts fetchAll (`users.filter(role === 'teacher')`)
  - **Problem**: teacher options include deactivated teachers (GET /users returns `isActive`, the filter ignores it). Backend `assertTeachers` (class-groups.service.ts:26-37) checks only role, so an inactive teacher can be assigned.
  - **Why it matters**: lessons/payroll tied to a person who cannot log in; group shows as taught by someone absent.
  - **Suggested fix**: filter `isActive` in the store (add `isActive` to the frontend `User` type) and add `isActive: true` to the backend check.
  - **Severity**: medium

- **Page / form**: classes/ui/GroupModal.tsx:115-136 (both tariffs optional), backend lessons.service.ts:300-304
  - **Problem**: a group can be saved with no single-lesson tariff (or one with no price on the date). Marking a child who has no package then fails with 400 `No price for this date`, and because marking runs in one transaction the whole save of the lesson (all marks) is rolled back.
  - **Why it matters**: teacher loses the whole lesson's marks for one child; the cause (group setup) is not visible on the mark page.
  - **Suggested fix**: warn in GroupModal when «Тариф разового заняття» is empty (text: such children cannot be marked without a package); or on MarkLessonPage disable marks for rows with `packageInfo === null` when the group has no single tariff (needs a `hasSingleTariff` flag in the roster, backend).
  - **Severity**: medium

- **Page / form**: classes/ui/GroupModal.tsx:115-136
  - **Problem**: tariff options show only the name (no price, package size, validity). Several package tariffs with similar names (e.g. «Майнкрафт 4», «Майнкрафт 8») cannot be told apart.
  - **Why it matters**: wrong tariff picked; this is the same field that now drives the «Пакет» purchase select.
  - **Suggested fix**: label as `name · currentPrice · packageSize занять`.
  - **Severity**: low

#### classGroup (AddMemberModal, ClassGroupPage, MarkLessonPage)

- **Page / form**: classGroup/ui/AddMemberModal.tsx:13-52, model/classGroupStore.ts:37-43
  - **Problem**: «Дитина» Autocomplete is fed with the full `GET /children` list: children already active in this group, and children of any institution or kind, are offered. Backend `addMember` (class-groups.service.ts:158-181) rejects only an overlapping membership of the same group (`Child is already a member`).
  - **Why it matters**: search noise in a large list; nothing prevents adding a child to a direction group in the wrong place, but the main waste is picking someone already in the group and getting an error.
  - **Suggested fix**: exclude children with an active member row in `group.members`.
  - **Severity**: low

- **Page / form**: classGroup/ui/MarkLessonPage.tsx:60-72, 160-185, model/markLessonStore.ts
  - **Problem**: teacher must click a status for every child; there is no «Усі присутні» (register and school-lesson pages have it). `save` sends only children with a chosen status, so unmarked children silently get no attendance at all.
  - **Why it matters**: the most frequent teacher flow in clubs needs N clicks instead of one; forgetting a child leaves no record and no package consumption, without any warning.
  - **Suggested fix**: add «Усі присутні» button (fills only empty rows) and/or warn on save about unmarked rows.
  - **Severity**: medium

- **Page / form**: classGroup/ui/MarkLessonPage.tsx:55-63 (guest rows), 160-185
  - **Problem**: guest (разовий учасник) rows are built with `packageInfo: null`, so a guest who does have an active package for this direction is shown «Без пакета — разове заняття». Backend `consume` picks the package anyway.
  - **Why it matters**: misleading info; the teacher/admin may think a single-lesson charge will be created.
  - **Suggested fix**: after addGuest, reload the roster (or return package info for guests); minimum: hide the chip for guests.
  - **Severity**: low

- **Page / form**: classGroup/ui/MarkLessonPage.tsx:218-232 (guest Autocomplete)
  - **Problem**: guest options are all children, including current members of the group (the add handler silently ignores them) and children already added as guests.
  - **Why it matters**: pointless options; user selects a member and nothing visible happens.
  - **Suggested fix**: filter out `roster.rows` and `guests` ids from `allChildren`.
  - **Severity**: low

- **Page / form**: classGroup/ui/ClassGroupPage.tsx:55-72
  - **Problem**: to mark today's lesson the user must first pick a date field (already today) and click «Відмітити заняття»; for admins it is a separate screen/click from the roster ("Склад") on the same page.
  - **Why it matters**: minor extra step; teachers get a direct button on MyClassesPage, admins do not.
  - **Suggested fix**: add a primary «Відмітити сьогодні» shortcut like MyClassesPage.
  - **Severity**: low

#### register (RegisterDayTab, RegisterPage)

- **Page / form**: register/ui/RegisterDayTab.tsx:114-128
  - **Problem**: for status «Відсутній» the reason defaults to «Не вказано» and is optional (backend does not require it, register.service.ts:256-283). The «Довідку надано» checkbox appears only after a reason is chosen, so a missing reason silently hides the document flag; excused/unexcused statistics (month tab) then count unreasoned absences as unexcused.
  - **Why it matters**: wrong «без поважної причини» totals if the teacher skips the select.
  - **Suggested fix**: highlight the empty reason on an absent child (soft warning on save); no backend change required.
  - **Severity**: low

#### absenceNotices

- Checked, no issues (approve is one click; reject/cancel need a reason by design; pure review page, no creation form).

#### absenceReasons

- Checked, no issues (defaults sensible; sortOrder defaults to 0).

#### calendar (CalendarDayModal)

- **Page / form**: calendar/ui/CalendarDayModal.tsx:33, 70-76, 120-152
  - **Problem**: «Для кого» offers «Садок» / «Школа» (scope by group kind) and «Заклад» (scope by a concrete institution) side by side. With institutions «Садок» and «Школа» existing, «Садок» (kind) and «Заклад → Садок» look identical to the user, though kind covers every institution of that type.
  - **Why it matters**: an entry meant for one institution may be saved for all institutions of the kind (or the reverse) and change working days / payroll in the wrong place.
  - **Suggested fix**: rename labels to «Усі садки (за типом)» / «Один заклад», or hide kind scopes when only one institution of the type exists.
  - **Severity**: medium

- **Page / form**: calendar/ui/CalendarDayModal.tsx:62-68
  - **Problem**: when a header institution is selected, the default scope is still «Усі» (for users who can share) while the institution field is prefilled but hidden; the user must change scope to «Заклад» to use it.
  - **Why it matters**: holiday meant for the selected institution is created globally by default.
  - **Suggested fix**: default scope to `institution` when `selectedInstitutionId` is set.
  - **Severity**: low

- **Page / form**: calendar/ui/CalendarDayModal.tsx:130-139
  - **Problem**: group select lists group names only; names are unique per institution, so two groups with the same name in different institutions are indistinguishable.
  - **Suggested fix**: append institution name when there are several.
  - **Severity**: low

#### schedule (EntryModal, ChangeDialog, TimetableTab, WeekTab)

- **Page / form**: schedule/ui/EntryModal.tsx:76 and schedule/ui/ChangeDialog.tsx:79, store schedule/model/scheduleStore.ts (loadMeta: `users.filter(role === 'teacher')`)
  - **Problem**: «Вчитель» lists inactive teachers. Backend (timetables.service.ts:105, lesson-changes.service.ts:58) requires `isActive: true` and answers with the misleading 400 `User is not a teacher`; the save fails only at «Зберегти» of the whole version, after the whole grid was filled.
  - **Why it matters**: late error with a wrong message; wasted effort rebuilding a draft.
  - **Suggested fix**: filter `isActive` in the store (same fix as GroupModal).
  - **Severity**: medium

- **Page / form**: schedule/ui/ChangeDialog.tsx:12-21, 34-47 (mode `replace`)
  - **Problem**: «Заміна» can be submitted with subject, teacher and room all «Без змін» (only the reason is required). Backend answers 400 `Nothing to replace` (lesson-changes.service.ts:80).
  - **Suggested fix**: require at least one of subject/teacher/room in the yup schema.
  - **Severity**: low

- **Page / form**: schedule/ui/ChangeDialog.tsx:57-61 (mode `extra`)
  - **Problem**: «Додатковий урок» period select offers all bell periods including ones already occupied for the whole class; only conflict detection after save rejects it. Teacher is a free choice (all teachers) with no hint of who is already busy.
  - **Suggested fix**: mark/disable periods that already have a lesson for that class on the date (data is in `weekData.days[].slots`).
  - **Severity**: low

- **Page / form**: schedule/ui/TimetableTab.tsx:46, 80-83
  - **Problem**: «Нова версія з» defaults to tomorrow, versions can only be saved at a future date, and an in-progress edit of a started version requires the extra step "type date + press Нова версія". The info alert states this, but a past/started version is read-only with no shortcut.
  - **Why it matters**: acceptable by design (started versions are immutable), listed only because the alert gives no one-click path.
  - **Suggested fix**: add a «Створити нову версію» button inside the alert using the default date.
  - **Severity**: low

#### scheduleSetup (BellScheduleModal, SubgroupModal, NamedTab)

- **Page / form**: scheduleSetup/ui/BellScheduleModal.tsx:19-21, 63
  - **Problem**: each added lesson starts empty ("Додати урок" appends `''`/`''`); the user types every start and end time by hand even though lessons are usually back-to-back.
  - **Why it matters**: re-typing for 6-8 periods per schedule.
  - **Suggested fix**: prefill new row start = previous end, end = start + previous duration.
  - **Severity**: low

- Checked, no issues: SubgroupModal (children already filtered by `c.group?.id === classId`; backend checks `Child is not in this class`), NamedTab, NameDialog.

#### lesson / myLessons

- Checked, no issues: LessonPage has «Усі присутні», topic/homework optional, absence reasons filtered to active; MyLessonsPage is read-only list with date default today.

#### myClasses

- Checked, no issues (direct «Відмітити сьогодні» shortcut present).

#### routine

- **Page / form**: routine/ui/CopyRoutineDialog.tsx:22-24, 49-58
  - **Problem**: «З групи» lists every other kindergarten group, including those without any routine template. Backend answers 404 `Routine template not found` (copy needs a version valid on `validFrom`). The preselected source is just the first group in the list.
  - **Why it matters**: user tries groups one by one until one works.
  - **Suggested fix**: backend/endpoint extra: return `hasTemplate` in `GET /routine/groups` and show only those (or mark the rest disabled). Alternative minimal: show the error text clearly (frontend swallows it with `catch { return }`, the global interceptor message must carry it).
  - **Severity**: low

- **Page / form**: routine/ui/RoutineItemsEditor.tsx:49-51
  - **Problem**: «+ Пункт» adds an item with empty times; day routines are contiguous, so the user types start and end each time.
  - **Suggested fix**: prefill new item start = previous item end.
  - **Severity**: low

- Checked, no issues: DayOverrideDialog (prefilled with the template items), template version dialog (offers "start from copy of selected version", date defaults today), copy-to-days tool.

### Audit: Audit: meals, payroll, reports, audit, backups, dashboard

Frontend root: D:\IT\EduNest\src\pages. Backend: D:\IT\backend-edu-nest\src.

#### Meals

- **Page / form**: Meals > Orders > "Замовлення" (AdminOrderDialog.tsx:73-75)
  - **Problem**: "Комплекс" lists every active complex, with no default and no price. It does not check that the child's price category has a price for the complex. It does not check that the published menu has a dish for each of the complex's courses. The admin only finds out after pressing "Замовити", from an error such as `2026-10-14: Complex has no price` or a missing-course error. The helper text says "Ціну рахує сервер", so the admin never sees the price.
  - **Why it matters**: Trial and error on a frequent admin flow. The backend rejects invalid combos (meal-orders.service.ts:166-185), so there is no data risk.
  - **Suggested fix**: Filter the complexes to those with a price for the child's group category on that date and with at least one menu dish per course. Show the price next to the name and auto-select when only one remains. Frontend only; the data is already loaded (`complex.prices`, `published.dishes`, `child.group.mealPriceCategoryId`).
  - **Severity**: medium

- **Page / form**: Meals > Orders > "Замовлення" (AdminOrderDialog.tsx:59-65, OrdersTab.tsx:154)
  - **Problem**: The dialog opens with an empty child and a list of all children with a group. It ignores the Group and Type filters already chosen on the Orders tab. The option label has the group name but not the institution, so same-named groups in two institutions look identical.
  - **Why it matters**: Extra searching. An admin working in one group still scrolls through the whole center.
  - **Suggested fix**: Pass `ordersGroupId` and `ordersKind` into the dialog and filter children by them. Add the institution to the label.
  - **Severity**: low

- **Page / form**: Meals > Menu > day dialog "Також для закладів" (MenuDayDialog.tsx:212-235, InstitutionMultiSelect.tsx:12)
  - **Problem**: The multi-select offers every active institution, including ones where the dishes or the date do not apply, and ones the user is not editing. Saving writes the same dish set to every ticked institution and overwrites their draft for that date.
  - **Why it matters**: One mis-click overwrites another institution's menu day. The backend accepts it (menus.service per-institution upsert).
  - **Suggested fix**: Show which ticked institutions already have a different menu for that date ("буде замінено"). No backend change needed; `getMenuDays` already returns the data per institution.
  - **Severity**: low

- **Page / form**: Meals > Menu > "Заповнити з шаблону" (ApplyTemplateDialog.tsx:127 vs :143)
  - **Problem**: The default "По" is `menuStart + weeks*7 - 1`, which includes the weekend. The "N тижнів" chips end on Friday (`n*7 - 3`). The two defaults disagree.
  - **Why it matters**: Confusing; the weekend is skipped anyway because non-working days are ignored.
  - **Suggested fix**: Use the same end-of-week rule for the initial value.
  - **Severity**: low

#### Payroll

- **Page / form**: Payroll > Terms > "Нова версія умов" (TermsDialog.tsx:93, TermsTab.tsx:122)
  - **Problem**: A new version starts from scratch (monthly rate "0", no rates, no allowances, empty extra-hour rate). The teacher's current open version is on screen but is not copied. To change one rate, the user re-types every lesson rate and every allowance.
  - **Why it matters**: Double work on every raise or change. A forgotten rate row means lessons are paid 0 from the new date. The backend accepts a version with no rates (the form warns "заняття рахуватимуться з сумою 0").
  - **Suggested fix**: Prefill the new-version form from the latest version of the selected teacher (all fields except `validFrom`). Frontend only.
  - **Severity**: high (silent 0 pay if rows are lost; also the largest time sink in this module)

- **Page / form**: Payroll > teacher card > "Виплата" (PaymentDialog.tsx:273)
  - **Problem**: "Сума" starts empty, although the card already has `totals.balance` (accrued minus paid). The accountant re-types the amount to pay out.
  - **Why it matters**: Retyping a figure the system already knows, which can cause typos in money. The backend accepts any amount and overpayment (by design).
  - **Suggested fix**: Prefill the amount with the positive remaining balance, editable.
  - **Severity**: medium

- **Page / form**: Payroll > Terms and Sheet teacher pickers (payrollStore.ts:101-104, TermsTab.tsx:112)
  - **Problem**: The teacher list is every user with role `teacher`, including deactivated ones and ones with no salary terms. In the terms tab the user can open a "new version" for a dismissed teacher.
  - **Why it matters**: Clutter. The backend accepts terms for an inactive teacher (salary-terms.service.ts:96-98 only checks the role).
  - **Suggested fix**: Hide inactive teachers by default, or mark them. Optionally reject in the backend.
  - **Severity**: low

- **Page / form**: Payroll > Terms > rate rows (TermsDialog.tsx:120-124, payrollStore.ts:106-112)
  - **Problem**: The "Гурток" options come from all groups of all directions, including inactive groups and directions. A group with a price in no one's package is listed alongside current ones. Names are `Напрям: Група`, so there is no way to tell active from archived.
  - **Why it matters**: Easy to attach a rate to an archived group. The backend accepts it if the group exists.
  - **Suggested fix**: Filter by `active`, keeping the group already selected (the same pattern already used for subjects).
  - **Severity**: low

- **Page / form**: Payroll > teacher card > "Додаткові години" (ExtraHoursDialog.tsx:493-504)
  - **Problem**: "Власна ставка" is blank with the hint "ставка з умов оплати", but the dialog does not show what that rate is, or that the terms have none. A record with no rate anywhere counts as 0 with a `noRate` warning that only appears after saving.
  - **Why it matters**: The user finds out about a missing rate only after adding the hours. The backend accepts it.
  - **Suggested fix**: Show the extra-hour rate from the effective terms in the helper text, and warn up front if there is none. Needs the rate in the detail response (the field is on terms already).
  - **Severity**: low

#### Reports

- **Page / form**: Reports > filters (ReportFilters.tsx:131, 210-220)
  - **Problem**: "Група" lists all groups, filtered only by kind, not by the chosen "Заклад". The user can pick institution A and a group of institution B. "Дитина" lists all children and is not narrowed by institution, kind or group.
  - **Why it matters**: The backend accepts the combination (report-query.ts:35-62 only checks that each is in scope) and combines them with AND. The result is a silently empty report, which looks like "no data".
  - **Suggested fix**: Narrow the group list by `query.institutionId` and the child list by institution and group. Clear `groupId` when the institution changes. A backend 400 for a mismatched group/institution is optional.
  - **Severity**: medium

- **Page / form**: Reports > filters "Тип групи" next to "Заклад" (ReportFilters.tsx:171-209)
  - **Problem**: An institution already has a type (the type is copied from the institution). The user can pick both, for example a kindergarten institution with "Школа", which gives an empty report. The type filter is not hidden after an institution is chosen.
  - **Why it matters**: A redundant filter and a nonsense combination that the backend accepts and answers with an empty report.
  - **Suggested fix**: Hide or disable "Тип групи" when an institution is chosen.
  - **Severity**: low

- **Page / form**: Reports > "Вчитель" (ReportFilters.tsx:116-119)
  - **Problem**: All users with role teacher are listed, including deactivated ones. The list needs `users: view`, so a user with only `payroll: view` has no teacher filter at all (`available.teacher = canListUsers`).
  - **Why it matters**: Minor clutter; accountants lose the per-teacher payroll filter.
  - **Suggested fix**: Source the teachers from the payroll teacher list when the user has `payroll` only. Frontend, or a small backend endpoint.
  - **Severity**: low

#### Checked, no issues

- Meals: PriceDialog (category prefills the current price, date defaults to today), ComplexDialog, DishDialog (course preset from the block, locked on edit), TemplateDialog, CopyMenuDialog, MenuPeriodDialog, directories and dish type blocks, CancelOrderDialog.
- Payroll: AdjustmentDialog, AbsenceDialog (end date follows start, start defaults to today or the first of the month), CloseTermsDialog, WorkedDaysForm, ReasonDialog.
- myPayroll page (read only).
- Audit: EventsTab and LoginsTab filters (filters only; the staff list excludes parents).
- Backups page (one button, no form).
- Dashboard page (read only cards).

### Audit: Audit: users, positions, institutions, groups, children, parent cabinet, auth pages

Frontend = D:\IT\EduNest\src, backend = D:\IT\backend-edu-nest\src.

#### users

- **Create user dialog** (pages/users/ui/CreateUserModal.tsx:81-92, model/usersStore.ts:73-84)
  - Problem: the dialog has one scope block (accessScope + institutions) but saves in two calls: `POST /users`, then `PATCH /users/:id/access`. The dialog closes before the second call, and its error is swallowed (`.catch(() => undefined)`). `CreateUserDto` has no scope fields.
  - Why it matters: if the second call fails, the user exists with the default scope. That is `all` for a root creator, or the creator's scope. An employee meant for one institution gets wider access, and the form shows no sign of it. Wrong data / security risk.
  - Fix: backend, accept `accessScope` and `institutionIds` in `POST /users` and apply them in the same transaction. Drop the second call.
  - Severity: high

- **Create / edit user: login and password** (CreateUserModal.tsx:121-135, 188-210)
  - Problem: for a parent the phone is required, but the login is a separate manual field. The admin types the password and chooses a login by hand every time. No suggestion and no generator.
  - Why it matters: extra typing on a frequent flow (every new family). The admin must also pass the password to the parent.
  - Fix: prefill the login from the normalized phone for parents. Add a "generate password" button (frontend only).
  - Severity: low

- **Edit user vs "Доступ" dialog** (EditUserModal.tsx:115-126, AccessDialog.tsx, UsersPage.tsx:60-66)
  - Problem: position and institution scope can be changed in both EditUserModal and AccessDialog. They use two different code paths: `PATCH /users/:id` with `positionId`, then `applyScope`, versus `PATCH /users/:id/access`.
  - Why it matters: two entry points for the same change, so the user does not know which to use. Wording is inconsistent ("Обмеження" vs "Доступ до закладів").
  - Fix: drop position and scope from EditUserModal for staff, or drop AccessDialog. Keep one place.
  - Severity: low

- **Delete user without confirmation** (UsersPage.tsx:72-75)
  - Problem: the trash icon calls `deleteUser(id)` immediately. No confirmation anywhere in the frontend (grep for confirm / ConfirmDialog finds nothing). The same happens for children, groups and institutions: ChildrenPage.tsx:94, institutions/ui/GroupRow.tsx:87,156,221, InstitutionBlock.tsx:102.
  - Why it matters: one mis-click permanently deletes a record. The backend only blocks deletion when dependent records exist, so a new or empty child, user or group is lost at once.
  - Fix: one shared confirm dialog for all delete buttons (frontend).
  - Severity: medium

#### groups / widgets/groupForms

- **Teachers select** (widgets/groupForms/ui/CreateGroupModal.tsx:55, EditGroupModal.tsx:55; backend groups.service.ts:57-74)
  - Problem: the options are `users.filter(role === 'teacher')`. That includes deactivated users and teachers whose access scope does not include the group's institution. The label is only "Прізвище Ім'я".
  - Why it matters: `validateTeachers` checks only `role === teacher`, with no `isActive` and no scope check, so the backend accepts both. A dead or out-of-scope teacher gets assigned to the group.
  - Fix: filter `isActive` and teachers whose scope covers the selected institution (frontend). Optionally reject inactive teachers in the backend.
  - Severity: medium

- **Bell schedule select** (CreateGroupModal.tsx:156-162, EditGroupModal; backend groups.service.ts:76-98)
  - Problem: `bellSchedules.map(...)` shows inactive schedules. The meal category select right below filters `active`, so the two selects behave differently.
  - Why it matters: `assertBellSchedule` has no `active` check, so a deactivated schedule can be attached to a new class. A new school class with none chosen has an empty timetable setup, and nothing suggests picking one even when only one exists.
  - Fix: filter `active || id === current`. Preselect the schedule when exactly one active one exists. Optionally add an active check in the backend.
  - Severity: medium

- **Groups page needs users:view** (pages/groups/ui/GroupsPage.tsx:41-45, backend users.controller.ts:24,35)
  - Problem: the page calls `fetchUsers()` to fill the Teachers select. `GET /users` needs `users: view`, but the groups page needs only `children`. A staff member with `children: edit` and no `users: view` gets a 403 and an empty teacher list in the form. The same happens in ChildrenPage.tsx:115 for the parents list, and in institutions/model/structureStore.ts:93 (`fetchLookups`).
  - Why it matters: a user who can create groups and children cannot assign teachers or parents. The failure is silent or a generic error toast.
  - Fix: backend, add a slim endpoint (for example `GET /users/lookup?role=teacher|parent`, id and name only) under `children` view. Or hide the fields and say why.
  - Severity: medium

#### children / widgets/childForms

- **Group select in the create child form** (widgets/childForms/ui/CreateChildModal.tsx:131-147, EditChildModal.tsx:~178)
  - Problem: `getOptionLabel` is `option.name` only. Group names are unique per institution only (backend groups.service.ts:126-134), so two institutions can both have "Сонечко" and the options look identical. The list also includes groups of inactive institutions. ChildrenPage's own filter does show "name · institution".
  - Why it matters: the child can be placed in the wrong institution. For inactive institutions the backend rejects it only after submit (`Institution is inactive`, children.service.ts:119).
  - Fix: label as `name · institution` and hide groups whose institution is inactive (Group has no isActive, so add it to the response or look it up in the institution store).
  - Severity: medium

- **Create child from the children page ignores the current context** (ChildrenPage.tsx:87-98, 308-316; CreateChildModal.tsx:55-57)
  - Problem: when the "Група" filter is set, "Створити учня" opens a form with an empty group. `presetGroupId` exists and is used only on the institutions page. With a single group available, nothing is preselected either.
  - Why it matters: the user picks again what the page already knows.
  - Fix: pass `presetGroupId={groupId}` and preselect when there is exactly one option.
  - Severity: medium

- **Parent selection when creating a child** (CreateChildModal.tsx:149-163, EditChildModal.tsx:~199)
  - Problem: parents come from the full users list. The label is "Прізвище Ім'я" with no phone, and inactive parents are included. A parent who does not exist yet cannot be created here, so the admin leaves for the Users page, creates the parent, and comes back.
  - Why it matters: homonyms (two "Коваленко Олена") cannot be told apart, and a new family takes several screens. The backend `validateParents` checks only role, not isActive.
  - Fix: show the phone in the option label, drop inactive parents, add "Новий батько" inline or a link to the user creation dialog.
  - Severity: medium

#### institutions

- Checked, no issues beyond the delete confirmation above. The create-group and create-child flows from an institution block are preset correctly (lockedInstitutionId, presetGroupId). The type of an existing institution is only editable by the backend rule.

#### positions

- Checked, no issues. `teaching` is locked when the position has users. Levels the actor does not hold are disabled. The backend validates the rest.

#### header institution switcher

- Checked, no issues (hidden for a single institution, inactive ones marked, selection dropped when outside scope).

#### parent cabinet

- **Meals ordering** (pages/familyChild/ui/MealsTab.tsx:90-122)
  - Problem: for each day the parent ticks "Замовити", picks a complex, and picks dishes for each course with several options. Choosing a complex already sets `include: true`, so the checkbox only repeats it. A week means about five checkboxes and five complex selects. There is no "same for all days". A single complex is not preselected.
  - Why it matters: a parent doing the same order every week repeats about 10-15 actions.
  - Fix: preselect the complex when only one exists. Add "Застосувати до всіх днів" or remember last week's choice. Drop the separate checkbox or keep it only to untick.
  - Severity: medium

- **Paying from the family page** (pages/family/ui/FamilyPage.tsx:61-69, 78-80; familyChild/ui/FamilyChildPage.tsx:22, ChildFinanceTab.tsx:122)
  - Problem: the family page shows "До оплати" per child, but there is no pay button. The parent clicks "Детальніше", lands on the "Картка" tab, switches to "Фінанси", picks the category, then the dialog. A parent with one child still passes through the family list.
  - Why it matters: paying is the most frequent parent action, and it takes about four steps.
  - Fix: open the Фінанси tab when `due > 0`. Add "Оплатити" on the child card. Auto-open the only child.
  - Severity: medium

- **Absence notice dates** (familyChild/ui/NoticeDialog.tsx:63-72, 22-32)
  - Problem: both dates default to today. If the parent moves "З дати" to a later day, "По дату" stays earlier and shows "Кінець раніше за початок", so they must edit it as well. A one-day absence still needs two dates.
  - Why it matters: double work on a common case.
  - Fix: when start changes, set end = start if end < start. Add a "Один день" shortcut.
  - Severity: low

- Checked, no issues: PayDialog (amount prefilled with due, category fixed by the card), PaymentReturnBanner, pay/PayLinkPage (everything comes from the link), pay/TestBankPage, ChildCardTab, visits, schedule, routine.

#### login / profile / changePassword

- **Login: Enter does not submit** (pages/login/ui/LoginPage.tsx:55-128)
  - Problem: there is no `<form>`, `type="submit"` or key handler. Only a click on "Увійти" works. The same holds for PasswordFields (shared/ui/PasswordFields.tsx) used by ChangePassword and Profile.
  - Why it matters: on the most used screen, pressing Enter after the password does nothing (especially on mobile with a keyboard "Go").
  - Fix: wrap in a form or add `onKeyDown` Enter.
  - Severity: low

- **Profile: clearing the phone silently does nothing** (pages/profile/ui/ProfilePage.tsx:46-49; backend auth/dto/update-contacts.dto.ts, auth.service.ts:241-252)
  - Problem: for non-parent staff, an emptied phone is sent as `undefined`, so it is omitted from JSON and the backend skips it (it accepts `null`). The toast says "Контакти збережено" but the phone stays. Email correctly sends `null`.
  - Why it matters: the saved data does not match the form.
  - Fix: send `phone: phone || null` for non-parents.
  - Severity: low

- Checked, no issues: ChangePasswordPage (forced change, logout option).

#### Summary

High 1, medium 9, low 5.
