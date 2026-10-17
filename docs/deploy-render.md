# Розгортання на безкоштовних сервісах (Render + Neon + Netlify)

Схема без картки і без власного комп'ютера:

- **Neon**: база Postgres 16 (Франкфурт), дані зберігаються постійно.
- **Render**: бекенд (Франкфурт, безкоштовний web service).
- **Netlify**: фронтенд. Запити `/api/*` Netlify проксує на Render, тому для браузера фронт і API на одному сайті й cookies працюють (зокрема на iPhone).
- **cron-job.org**: кожні 10 хв будить бекенд, щоб він не засинав і нічні задачі (нарахування о 03:00, чистка аудиту) виконувались.
- **GitHub Actions**: щоночі копія бази на Google Drive.

Вбудований модуль бекапів на Render не працює (немає `pg_dump` і постійного диска), тому `BACKUP_DIR` порожній, а копії робить GitHub Actions. Картка «Резервні копії не налаштовані» на сторінці «Сьогодні» в цій схемі очікувана.

## 1. Neon (база)

1. Зареєструйтеся на https://neon.tech (можна через GitHub).
2. Create project: Postgres version **16** (як локальний Docker, щоб копії відновлювались і локально), region **AWS Europe Central 1 (Frankfurt)**.
3. Connect → вимкніть **Connection pooling** і скопіюйте рядок підключення (`postgresql://...neon.tech/neondb?sslmode=require...`). Це `DATABASE_URL` для Render і секрет `BACKUP_DATABASE_URL` для копій.

## 2. Render (бекенд)

1. Зареєструйтеся на https://render.com через GitHub і дайте доступ до репозиторію `backend-edu-nest`.
2. New → Web Service → `backend-edu-nest`:
   - Name: `edunest-backend` (адреса буде `https://edunest-backend.onrender.com`; якщо назва зайнята, адреса інша, тоді виправте її в `netlify.toml` фронтенду і в cron-job.org).
   - Region: **Frankfurt**.
   - Runtime: Node. Instance type: **Free**.
   - Build Command: `npm ci --include=dev && npx prisma generate && npm run build`
   - Start Command: `npx prisma migrate deploy && npm run start:prod`
   - Health Check Path (Advanced): `/online-payments/config`
   - Auto-Deploy: **Off** (оновлюємо вручну після копії бази, розділ 7).
3. Environment variables:

   | Ключ | Значення |
   | --- | --- |
   | `NODE_VERSION` | `22` |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | рядок з Neon |
   | `JWT_SECRET` | довгий випадковий рядок (наприклад, 96 символів з генератора паролів) |
   | `JWT_ACCESS_EXPIRES` | `15m` |
   | `JWT_REFRESH_EXPIRES` | `30d` |
   | `ROOT_LOGIN` | `root` |
   | `ROOT_PASSWORD` | сильний пароль |
   | `CORS_ORIGIN` | адреса Netlify, наприклад `https://edunest.netlify.app` |
   | `PUBLIC_APP_URL` | та сама адреса Netlify |
   | `TRUST_PROXY` | `true` |

   `BACKUP_DIR` і `PAYMENT_PROVIDER` не додавайте.
4. Create Web Service. У Logs мають з'явитися застосовані міграції і запуск Nest без помилок.

## 3. Netlify (фронтенд)

1. У репозиторії фронтенду в `netlify.toml` перевірте адресу бекенду в правилі `/api/*` і запуште.
2. Зареєструйтеся на https://netlify.com через GitHub → Add new project → Import from Git → `frontend-edu-nest`. Налаштування збірки беруться з `netlify.toml`.
3. Project configuration → Change project name, наприклад `edunest` → адреса `https://edunest.netlify.app`.
4. Якщо адреса відрізняється від вказаної в Render, виправте там `CORS_ORIGIN` і `PUBLIC_APP_URL`.
5. Відкрийте сайт і увійдіть як root.

Фронтенд Netlify оновлює сам після кожного push у `main`: це безпечно, даних він не зберігає.

## 4. cron-job.org (щоб бекенд не засинав)

1. Зареєструйтеся на https://cron-job.org.
2. Create cronjob: URL `https://edunest-backend.onrender.com/online-payments/config`, розклад кожні 10 хвилин.

Ця адреса не звертається до бази, тому Neon спить, поки ніхто не працює, і ліміт обчислень Neon не витрачається на пінги. Не міняйте її на інший маршрут.

## 5. Копії бази на Google Drive (GitHub Actions)

1. Встановіть rclone на свій комп'ютер (https://rclone.org/downloads/), виконайте `rclone config`: new remote, name `gdrive`, storage `drive`, решта за замовчуванням, авторизуйтеся в браузері.
2. `rclone config file` покаже шлях до файлу налаштувань. Скопіюйте весь його вміст.
3. GitHub → `backend-edu-nest` → Settings → Secrets and variables → Actions → New repository secret:
   - `RCLONE_CONFIG`: вміст файлу rclone;
   - `BACKUP_DATABASE_URL`: рядок підключення Neon.
4. Actions → Database backup → Run workflow (kind `manual`). Переконайтеся, що на Google Drive з'явилась тека `edu-backups` з файлом `edu_db_..._manual.dump`.

Розклад: щодня о 02:15 або 03:15 за Києвом (залежно від літнього часу; GitHub може запускати із запізненням). Копії старші за 60 днів видаляються, копія першого числа місяця додатково зберігається в `edu-backups/monthly` назавжди. Інша тека чи remote: змінна репозиторію `BACKUP_REMOTE` (наприклад `gdrive:інша-тека`).

Секрет `RCLONE_CONFIG` дає доступ до вашого Google Drive: нікому не показуйте його вміст.

## 6. Перевірка

- Root входить, сторінки відкриваються, після оновлення сторінки (F5) сесія зберігається.
- Вхід з телефона (Safari на iPhone теж).
- Наступного дня: у логах Render є запуск нарахування о 03:00, на Google Drive з'явилась нічна копія.

## 7. Оновлення

1. На своєму комп'ютері: перевірки, коміт, push бекенду і фронтенду.
2. GitHub → Actions → Database backup → Run workflow (`manual`). Дочекайтеся зеленого статусу.
3. Render → `edunest-backend` → Manual Deploy → Deploy latest commit. Стежте за Logs: міграції застосовуються під час старту.
4. Фронтенд Netlify оновить сам після push.

Якщо міграція впала, деплой у Render завершиться помилкою (причина в Logs). Виправте міграцію або відновіть копію з кроку 2 (розділ 8).

## 8. Відновлення копії в Neon

Потрібні клієнтські програми PostgreSQL 16 на своєму комп'ютері: інсталятор https://www.postgresql.org/download/windows/, у компонентах залиште лише **Command Line Tools**, додайте `C:\Program Files\PostgreSQL\16\bin` у `PATH`.

1. Render → `edunest-backend` → Settings → Suspend Web Service. Поставте на паузу і cron-job.org.
2. Завантажте потрібну копію з Google Drive.
3. У PowerShell у папці бекенду (локальний бекенд зупинений):

   ```powershell
   $env:DATABASE_URL = "<рядок підключення Neon>"
   $env:BACKUP_PG_CONTAINER = " "
   npm run backup:restore -- "C:\шлях\до\edu_db_....dump"
   npx prisma migrate deploy
   ```

   `BACKUP_PG_CONTAINER` дорівнює пробілу навмисно: так скрипт використовує локальні `pg_dump`/`pg_restore`, а не Docker. Перед відновленням скрипт сам робить копію поточної бази Neon у `BACKUP_DIR` з вашого `.env`.
4. Закрийте це вікно PowerShell (щоб випадково не працювати з Neon), запустіть сервіс у Render (Resume) і cron-job.org.

## 9. Дані з сервера на своєму комп'ютері (для пошуку багів)

Завантажте копію з Google Drive і відновіть її в локальну базу Docker звичайним способом:

```powershell
npm run backup:restore -- "C:\шлях\до\edu_db_....dump"
npx prisma migrate deploy
```

Тут `DATABASE_URL` береться з локального `.env`, Neon це не зачіпає. Пам'ятайте: це реальні дані дітей і батьків, не передавайте копії стороннім.

## Обмеження безкоштовних тарифів

- Neon: 0.5 GB. Журнал аудиту зберігає зміни 365 днів, тому раз на місяць дивіться розмір бази в панелі Neon.
- Render Free: 750 годин на місяць на акаунт, вистачає рівно на один сервіс, що працює цілодобово. Другий безкоштовний сервіс в тому ж акаунті не створюйте.
- Якщо cron-job.org перестане пінгувати, бекенд засинатиме: перше відкриття чекатиме близько хвилини, а нарахування о 03:00 не виконається. Пропущене нарахування можна запустити вручну: `POST /billing/run`.
- Умови безкоштовних тарифів змінюються; перевіряйте листи від сервісів.

## Правила, щоб не втратити дані

- Не запускайте з рядком підключення Neon `npx prisma migrate reset`, `npx prisma migrate dev`, `npx prisma db push`.
- Міграції створюються лише локально (`npx prisma migrate dev`). Перед комітом читайте SQL: `DROP COLUMN`, `DROP TABLE`, перейменування (Prisma робить видалення + додавання) і новий `NOT NULL` стовпець без `DEFAULT` знищують або ламають дані. Такі міграції доповнюйте перенесенням даних вручну.
- Застосовані міграції не редагуйте.
- Перед кожним деплоєм бекенду: ручна копія (розділ 7, крок 2).
