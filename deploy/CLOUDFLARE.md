# Cloudflare Migration

Current stack:
- `Express`
- `Socket.IO`
- local `roms/`
- local `cover-cache/`

This stack cannot be moved to free Cloudflare "as is".

Cloudflare-native target:
- Workers Static Assets for `client/`
- Durable Objects for room state and realtime multiplayer sockets
- R2 for ROM files, covers, and library metadata
- browser upload flow instead of local `roms/` folder

Why:
- free Cloudflare Containers are not available, so running the existing Node server in a container is not the right path
- Cloudflare recommends Durable Objects when multiple WebSocket clients need a single point of coordination
- R2 is the storage layer for binary ROM and cover files

What is already ready:
- `wrangler` is available locally
- Cloudflare account is already logged in on this machine

What the migration needs:
1. Replace `Socket.IO` transport with Cloudflare Worker WebSockets.
2. Move room/session state from in-memory `RoomManager` into a Durable Object.
3. Move ROM and cover storage from disk into R2.
4. Add a small upload/admin flow for ROMs and optional local covers.
5. Deploy Worker + assets with `wrangler deploy`.

Useful commands after migration:
```powershell
npx wrangler r2 bucket create nes-switch-online-roms
npx wrangler r2 bucket create nes-switch-online-covers
npx wrangler deploy
```

Notes:
- `trycloudflare` tunnel is only for temporary testing and still depends on your PC.
- permanent cloud hosting means rewriting the backend to Workers primitives.
