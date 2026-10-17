# Розгортання на сервері (Oracle Cloud Always Free)

Схема: один сервер Ubuntu. Postgres у Docker (дані в томі `postgres_data`), бекенд як сервіс systemd, Caddy віддає фронтенд і проксує `/api/*` на бекенд, сам отримує HTTPS-сертифікат. Фронтенд і API на одному домені, тому cookies і CORS працюють без додаткових налаштувань.

Приклади нижче використовують домен `edunest.duckdns.org` і користувача `ubuntu`. Замініть на свої.

## 1. Сервер

1. Зареєструйтеся в Oracle Cloud (потрібна картка для перевірки, гроші не списуються). Домашній регіон оберіть Germany Central (Frankfurt), змінити його потім не можна.
2. Compute → Instances → Create instance:
   - Image: Canonical Ubuntu 24.04 (aarch64).
   - Shape: Ampere `VM.Standard.A1.Flex`, 2 OCPU, 12 GB RAM.
   - Додайте свій публічний SSH-ключ.
   - Якщо пише "Out of capacity", спробуйте інший Availability Domain або пізніше.
3. Відкрийте порти 80 і 443:
   - Networking → Virtual Cloud Networks → ваша мережа → Security Lists → Default → Add Ingress Rules: Source `0.0.0.0/0`, TCP, Destination port `80`, потім так само `443`.
   - На самому сервері (образи Oracle блокують порти ще й у iptables):

     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```

4. Домен: на https://www.duckdns.org увійдіть, створіть піддомен (наприклад `edunest`) і вкажіть публічну IP-адресу сервера.

## 2. Програми

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git rsync curl

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Caddy: встановіть за інструкцією https://caddyserver.com/docs/install#debian-ubuntu-raspbian.

Після `usermod` вийдіть із SSH і зайдіть знову, щоб `docker` працював без `sudo`.

## 3. Код

```bash
cd ~
git clone https://github.com/<you>/backend-edu-nest.git
git clone https://github.com/NazarOstapyuk/frontend-edu-nest.git EduNest
```

Для приватних репозиторіїв використайте GitHub deploy key або personal access token.

## 4. Налаштування бекенду

Згенеруйте паролі (тільки латиниця і цифри, щоб не ламати `DATABASE_URL`):

```bash
openssl rand -hex 24   # пароль бази
openssl rand -hex 48   # JWT_SECRET
```

Файл `~/backend-edu-nest/.env`:

```env
POSTGRES_PASSWORD=<пароль бази>
DATABASE_URL=postgresql://postgres:<пароль бази>@localhost:5432/edu_db
JWT_SECRET=<секрет>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d
ROOT_LOGIN=root
ROOT_PASSWORD=<сильний пароль>
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://edunest.duckdns.org
PUBLIC_APP_URL=https://edunest.duckdns.org
BACKUP_DIR=/home/ubuntu/edu-backups
BACKUP_PG_CONTAINER=edu_postgres
PAYMENT_PROVIDER=
```

`POSTGRES_PASSWORD` діє лише при першому створенні бази. Потім змінювати його в `.env` марно: пароль уже записаний у базі.

## 5. Перший запуск

```bash
cd ~/backend-edu-nest
docker compose -f docker-compose.prod.yml up -d
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build

sudo cp deploy/edunest-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edunest-backend
journalctl -u edunest-backend -n 50
```

Якщо користувач або папка інші, виправте `User` і `WorkingDirectory` у `/etc/systemd/system/edunest-backend.service`.

## 6. Фронтенд

```bash
cd ~/EduNest
echo "VITE_API_URL=/api" > .env.production.local
npm ci
npm run build
sudo mkdir -p /var/www/edunest
sudo rsync -a --delete dist/ /var/www/edunest/
```

## 7. Caddy

```bash
sudo cp ~/backend-edu-nest/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # вкажіть свій домен у першому рядку
sudo systemctl reload caddy
```

Відкрийте `https://edunest.duckdns.org` і увійдіть як root.

## 8. Оновлення

На своєму комп'ютері: закомітьте і запуште бекенд і фронтенд. На сервері:

```bash
~/backend-edu-nest/deploy/deploy.sh
```

Скрипт:

1. робить копію бази в `BACKUP_DIR` (файл `..._manual.dump`, видно на сторінці «Резервні копії»);
2. `git pull`, `npm ci`, `prisma generate`, `prisma migrate deploy` (лише додає нові міграції), збірка, перезапуск сервісу, перевірка, що бекенд відповідає;
3. якщо є `~/EduNest`, оновлює і збирає фронтенд та викладає його в `/var/www/edunest`.

Будь-яка помилка зупиняє скрипт. Якщо міграція впала посередині, відновіть копію з кроку 1 (розділ 10).

## 9. Копія поза сервером

Копії в `BACKUP_DIR` не допоможуть, якщо пропаде сам сервер. Копіюйте їх на Google Drive через rclone:

```bash
sudo apt install -y rclone
rclone config        # remote "gdrive", тип drive; на кроці авторизації скористайтеся rclone authorize "drive" на своєму ПК
crontab -e
```

Рядок у crontab (щодня о 03:30 за часом сервера):

```
30 3 * * * rclone copy /home/ubuntu/edu-backups gdrive:edu-backups
```

Oracle може забрати Always Free сервер, який довго простоює. Тому ця копія обов'язкова.

## 10. Відновлення на сервері

```bash
cd ~/backend-edu-nest
sudo systemctl stop edunest-backend
npm run backup:restore -- <файл>
npx prisma migrate deploy
sudo systemctl start edunest-backend
```

Хоча б раз перевірте відновлення на своєму комп'ютері з копії, завантаженої з сервера.

## Правила, щоб не втратити дані

- Ніколи не запускайте на сервері `docker compose down -v`, `npx prisma migrate reset`, `npx prisma migrate dev`, `npx prisma db push`. Звичайні `docker compose -f docker-compose.prod.yml down`/`up -d`/`restart` безпечні.
- Міграції створюються лише на своєму комп'ютері (`npx prisma migrate dev`). Перед комітом прочитайте SQL: `DROP COLUMN`, `DROP TABLE`, перейменування (Prisma робить видалення + додавання) і новий `NOT NULL` стовпець без `DEFAULT` знищують або ламають дані. Такі міграції доповнюйте перенесенням даних вручну.
- Застосовані міграції не редагуйте.
- Не працюйте на своєму комп'ютері з серверною базою.
