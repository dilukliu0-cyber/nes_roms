# Server Deploy

## Option 1: Docker Compose

1. Install Docker Engine and Docker Compose plugin.
2. Copy the project to the server.
3. Put `.nes` files into `roms/`.
4. Start the app:

```bash
docker compose up -d --build
```

5. Check health:

```bash
curl http://127.0.0.1:3000/api/health
```

## Reverse Proxy

Use `deploy/nginx.conf.example` as the Nginx site config.

Important for online play:
- WebSocket upgrade must stay enabled for `/socket.io/`
- proxy timeouts should stay long

## Persistent Data

These folders stay on the server host:
- `roms/`
- `cover-cache/`

## Update

```bash
docker compose up -d --build
```

## Telegram Mini App

For Telegram bot launch:

1. Publish the app on a public `https://` URL.
2. Set these environment variables for the server:
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_MINI_APP_URL`
3. In BotFather, enable the Mini App for the bot and point it to the same public URL.
4. Run:

```bash
npm run telegram:menu
```

Room deep links can use this format:

```text
https://t.me/<bot_username>?startapp=room-ABC123
```

## Option 2: Render Free

This project can run on a free Render web service.

Recommended setup:
1. Push the project to GitHub.
2. Keep the `.nes` files you want to serve inside `roms/` before pushing.
3. In Render, create a new Blueprint or Web Service from the repo.
4. Use the included `render.yaml` or set these values manually:
   - Runtime: `Node`
   - Build Command: `npm ci --omit=dev`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`
5. Add environment variables:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_BOT_USERNAME`
   - `TELEGRAM_INIT_MAX_AGE_SECONDS=86400`
6. After the first deploy, copy the public `onrender.com` URL and add:
   - `TELEGRAM_MINI_APP_URL=https://<your-service>.onrender.com`

Important limitations of Render Free:
- the service spins down after 15 minutes without inbound traffic
- the first wake-up after idle takes about a minute
- runtime filesystem changes are lost on restart or redeploy
