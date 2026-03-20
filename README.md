# TX Flow Visualizer

Real-time Etherlink transaction flow monitor – pre-confirmation tracking visualised in the browser.

## Architecture

```
Browser 1 ──┐                              ┌── tez_newIncludedTransactions ──► EVM node
Browser 2 ──┤── ws://host:8080 ──► server ──┼── tez_newPreconfirmedReceipts ──► EVM node
Browser N ──┘   (fan-out + static files)   └── newHeads ──────────────────► EVM node
```

A single Node.js process:
- Serves the compiled React frontend (static files)
- Maintains exactly **3 persistent WebSocket connections** to the EVM node (one per subscription stream), regardless of how many browser clients are connected
- Fans out EVM events to every subscribed browser client → N clients = **3 upstream connections total** instead of 3×N

The EVM node URL (`TEZOS_WS_URL`) is a server-side environment variable and is **never** sent to browsers.

## Quick start (development)

```sh
cp .env.example .env        # fill in TEZOS_WS_URL with the real EVM node URL
npm install

# Terminal 1 – Node server (fan-out + WS)
npm run server:dev          # starts on http://localhost:3001

# Terminal 2 – Vite dev server with HMR
npm run dev                 # starts on http://localhost:8080
```

## Docker (single container)

```sh
# Create a .env file at the repo root:
#   TEZOS_WS_URL=wss://your-private-evm-node/ws
#   ALLOWED_ORIGINS=https://your-domain.com   (optional)

docker compose up --build   # app available on http://localhost:8080
```

## GCP Cloud Run deployment

Push to `main` to trigger the GitHub Actions workflow (`.github/workflows/deploy.yaml`).

Required GitHub secrets:

| Secret | Description |
|---|---|
| `GCP_PROJECT_ID` | GCP project ID |
| `GCP_SA_KEY` | Base64-encoded service account JSON key (roles: `run.admin`, `iam.serviceAccountUser`, `artifactregistry.writer`) |
| `TEZOS_WS_URL` | Private EVM node WebSocket URL |

Optional secrets: `ALLOWED_ORIGINS`, `RECONNECT_DELAY_MS`, `GCP_REGION`, `GCP_SERVICE_NAME`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TEZOS_WS_URL` | *(required)* | Private EVM node WebSocket URL |
| `PORT` | `8080` | Port the server listens on |
| `RECONNECT_DELAY_MS` | `3000` | Delay (ms) before retrying a dropped upstream connection |
| `ALLOWED_ORIGINS` | *(all)* | Comma-separated allowed browser origins |

## Technology stack

- **Frontend:** Vite · React 18 · TypeScript · shadcn/ui · Tailwind CSS
- **Server:** Node.js · TypeScript · [ws](https://github.com/websockets/ws)

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR on port 8080 |
| `npm run server:dev` | Node server with auto-reload on port 3001 |
| `npm run build` | Compile React frontend → `dist/` |
| `npm run build:server` | Compile Node server → `server-dist/` |
| `npm start` | Run the compiled server (serves both static files and WS) |
| `npm run lint` | ESLint |

