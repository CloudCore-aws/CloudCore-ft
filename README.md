# VaultDrop

Zero-trust temporary file sharing. Upload a file, choose when it expires, how many times it can be downloaded, and an optional passkey, then share a one-time link. Files self-destruct automatically.

## Features

- **Expiry:** 10 minutes, 1 hour or 24 hours
- **Download limits:** 1 (one-time), 3 or 10
- **Optional passkey**, stored as an argon2 hash
- **Multiple files** are zipped in the browser and sent as one archive (100MB total)
- **Share page** with one-click copy and a QR code
- **Receiver page** with passkey prompt, live countdown and downloads remaining
- **Automatic cleanup** of expired and used-up files every 5 minutes

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite, TypeScript, Tailwind CSS, TanStack Query, React Router |
| Backend | Node.js, Fastify, TypeScript, Prisma ORM |
| Data | PostgreSQL 16, Redis 7 (Docker) |
| Security | argon2, cryptographically random tokens, Redis-backed rate limiting |
| Tooling | pnpm workspaces, Docker Compose, GitHub Actions CI, ESLint |

> The client uses TypeScript 6 because typescript-eslint does not support TypeScript 7 yet.

## How it works

1. **Upload:** the sender uploads a file with its rules. The server stores it under a random key and returns a 256-bit share token.
2. **Status:** the receiver opens `/vault/<token>`. The server reveals only whether a passkey is required, with no file name or size.
3. **Unlock:** the receiver enters the passkey (rate-limited). The server returns the file details, a 60-second download ticket, and a 15-minute unlock session.
4. **Ticket refresh:** each further download gets a fresh ticket from the unlock session, without resending the passkey.
5. **Download:** the ticket is consumed once, the download count is decremented atomically, and the file is streamed.
6. **Cleanup:** a background worker deletes expired or exhausted files every 5 minutes and on startup.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/files` | Upload (multipart: `expiry`, `maxDownloads`, `passkey?`, then `file`) → `{ shareToken, expiresAt }` |
| `GET` | `/api/vault/:token/status` | `{ requiresPassword }` only |
| `POST` | `/api/vault/:token/unlock` | Body `{ passkey? }` → file details, `downloadTicket`, `unlockSession` |
| `POST` | `/api/vault/:token/ticket` | Body `{ unlockSession }` → fresh `downloadTicket`, `downloadsRemaining` |
| `GET` | `/api/vault/:token/download?ticket=…` | Streams the file (single-use ticket) |
| `GET` | `/health` | `{ ok: true }` |

## Security design

| Requirement | Implementation |
| --- | --- |
| No ID enumeration | Share tokens are 32 random bytes (base64url), not sequential IDs |
| No metadata before passkey | The status endpoint returns only `requiresPassword` |
| Passkeys safe at rest | argon2 hashes; plain passkeys are never stored |
| Brute-force protection | 5 unlock attempts per IP per link per 15 minutes (Redis) → HTTP 429 |
| Race-condition-proof download count | A single atomic `UPDATE … WHERE downloadsRemaining > 0`; two simultaneous downloads of a one-time file → exactly one succeeds |
| Leaked download URL is useless | Tickets are single-use (Redis `GETDEL`) and expire after 60 seconds |
| Sessions scoped to their link | Ticket refresh checks that the session belongs to the same file |
| Uploaded content can't execute | Forced `attachment` download plus `X-Content-Type-Options: nosniff` |
| Path traversal blocked | Storage keys are UUIDs, and the storage driver normalises and checks paths |
| No orphaned files | Oversized or failed uploads delete their partial file immediately |

## Project structure

```
├── client/                  React app
│   └── src/
│       ├── api.ts           API client and types
│       └── pages/           UploadPage, SharePage, VaultPage
├── server/
│   ├── Dockerfile
│   ├── prisma/              Schema and migrations
│   └── src/
│       ├── index.ts         Server entry
│       ├── lib/             Prisma, Redis, token helpers
│       ├── routes/          files.ts, vault.ts
│       ├── storage/         Storage interface and local disk driver
│       └── workers/         Cleanup worker
├── scripts/
│   └── security-tests.ps1   Security test suite
├── .github/workflows/ci.yml
└── docker-compose.yml       PostgreSQL, Redis, server
```

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 10+ (`npm install -g pnpm`)
- Docker Desktop

### Setup

```bash
git clone https://github.com/CloudCore-aws/CloudCore-ft.git
cd CloudCore-ft
pnpm install
docker compose up -d postgres redis
cp server/.env.example server/.env
pnpm --filter server exec prisma migrate dev
```

### Run in development

```bash
pnpm dev:server     # terminal 1, http://localhost:4000
pnpm dev:client     # terminal 2, http://localhost:5173
```

Open http://localhost:5173.

### Run the backend in Docker

```bash
docker compose up -d --build
```

Stop the Docker server (`docker compose stop server`) before running `pnpm dev:server`, since both use port 4000.

## Environment variables (`server/.env`)

| Variable | Example | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://vault:vault@localhost:55432/vaultdrop` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis for tickets, sessions, rate limits |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `STORAGE_DIR` | `./uploads` | Where uploaded files are stored |
| `PORT` | `4000` | Server port |

> The PostgreSQL host port is set in `docker-compose.yml`. It avoids the default 5432 so it doesn't clash with a locally installed PostgreSQL.

## Tests

With the server running, from the repo root (Windows PowerShell):

```powershell
.\scripts\security-tests.ps1
```

It checks enumeration, input validation, metadata hiding, passkey verification, single-use tickets, the nosniff header, session scoping, brute-force limiting, the simultaneous-download race condition, and the size limit.


## Known limitations

- Files are stored unencrypted on the server; access is protected, but contents are not end-to-end encrypted.
- Two files with the same name in one multi-file upload overwrite each other inside the zip.
- Runs as a single server instance with local disk storage. The storage interface is ready for an S3 driver.