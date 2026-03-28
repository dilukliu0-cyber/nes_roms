# NES Switch Online

Локальный проект для запуска NES ROM, автосканирования библиотеки, создания комнат и синхронной сетевой игры на 2 игроков.

## Быстрый старт

1. Положи `.nes` ROM-файлы в папку `roms/`.
2. Если хочешь свою обложку, положи рядом картинку с тем же именем:
   `Contra.nes` + `Contra.png`.
3. Выполни `cmd /c npm install`.
4. Выполни `cmd /c npm start`.
5. Открой `http://localhost:3000`.

## Как это работает

- Библиотека `roms/` сканируется автоматически.
- Для обложек используется такой порядок:
  локальная картинка рядом с ROM -> кэш из `cover-cache/` -> попытка скачать boxart -> автоматическая SVG-обложка.
- При создании комнаты выбранная игра привязывается к URL вида `/room/ABC123`.
- Оба клиента запускают один и тот же ROM, а управление синхронизируется покадрово через Socket.IO.
- Для защиты от рассинхрона есть проверка хэша кадра и восстановление по снапшоту от хоста.

## Управление

- Стрелки: движение
- `Z`: B
- `X`: A
- `Enter`: Start
- `Shift`: Select
- Gamepad: стандартная раскладка браузера тоже поддерживается

## Ссылка для друга

- В локальной сети хватит адреса вроде `http://192.168.x.x:3000/room/ABC123`.
- Для интернета нужно открыть порт `3000` на роутере или поднять туннель.
- Пример с Cloudflare Tunnel:
  `cloudflared tunnel --url http://localhost:3000`

## Структура

- `roms/` — ROM-файлы и необязательные локальные обложки с тем же именем.
- `cover-cache/` — автоматически скачанные и закэшированные обложки.
- `client/` — фронтенд.
- `server/` — сервер API, комнаты и сетевой слой.
## Telegram Mini App

Use the same client inside a Telegram bot Mini App.

- `TELEGRAM_BOT_TOKEN` - bot token from BotFather, required for `initData` validation
- `TELEGRAM_BOT_USERNAME` - bot username without `@`
- `TELEGRAM_MINI_APP_URL` - public HTTPS URL of this app
- `TELEGRAM_INIT_MAX_AGE_SECONDS` - optional validation window, default `86400`

Server endpoints:
- `GET /api/telegram/config`
- `POST /api/telegram/session`

Basic setup:
1. Publish the app on a public HTTPS URL.
2. In BotFather, enable the bot Mini App and point it to your public URL.
3. Export the Telegram env vars before starting the server.
4. Run `npm run telegram:menu` to set the bot menu button.
5. Share room invites as `https://t.me/<bot_username>?startapp=room-ABC123`

## Render Free

You can also deploy the current Node.js app to Render Free.

- the repo already includes a `render.yaml`
- Render Free sleeps after 15 minutes without traffic
- the first wake-up after idle takes about a minute
- runtime local file changes are not persistent on Free instances
