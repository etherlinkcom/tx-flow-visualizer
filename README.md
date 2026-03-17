# TX Flow Visualizer

Real-time Etherlink transaction flow monitor – pre-confirmation tracking visualised in the browser.

## Architecture

```
Browser 1 ──┐                                  ┌── tez_newIncludedTransactions ──► EVM node
Browser 2 ──┤── ws://backend:3001 ──► backend ──┼── tez_newPreconfirmedReceipts ──► EVM node
Browser N ──┘   (fan-out broadcast)             └── newHeads ──────────────────► EVM node
```

The **backend broadcast server** maintains exactly **3 persistent WebSocket connections** to the EVM node – one per subscription stream – regardless of how many browser clients are connected.  EVM events are fanned out to every subscribed browser client.  This means N clients cause **3 upstream connections total** instead of 3×N.

The EVM node URL (`TEZOS_WS_URL`) is a server-side environment variable and is never sent to the browser.  No changes to the frontend protocol are needed – the existing `eth_subscribe` / `eth_subscription` JSON-RPC flow is fully preserved.

## Quick start (development)

### 1. Backend

```sh
cd backend
cp .env.example .env        # fill in TEZOS_WS_URL with the real EVM node URL
npm install
npm run dev                 # starts broadcast server on ws://localhost:3001
```

### 2. Frontend

```sh
# in the repo root
cp .env.example .env        # VITE_WS_BACKEND_URL=ws://localhost:3001 (default)
npm install
npm run dev                 # starts Vite on http://localhost:8080
```

## Docker Compose (recommended for production)

```sh
# create a .env file at the repo root with:
#   TEZOS_WS_URL=wss://your-private-evm-node/ws
#   VITE_WS_BACKEND_URL=ws://your-public-host:3001

docker compose up --build
```

The frontend is served on **port 8080** and the proxy on **port 3001**.

## Environment variables

### Frontend (`.env` in repo root)

| Variable | Description |
|---|---|
| `VITE_WS_BACKEND_URL` | WebSocket URL of the **backend proxy** (e.g. `ws://localhost:3001`) |

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `TEZOS_WS_URL` | *(required)* | Private EVM node WebSocket URL, e.g. `wss://node/ws` |
| `PORT` | `3001` | Port the broadcast server listens on |
| `RECONNECT_DELAY_MS` | `3000` | Delay before retrying a dropped upstream connection |
| `ALLOWED_ORIGINS` | *(all)* | Comma-separated browser origins to whitelist, e.g. `https://stream.proofofspeed.xyz` |

## Technology stack

- **Frontend:** Vite · React 18 · TypeScript · shadcn/ui · Tailwind CSS
- **Backend:** Node.js · TypeScript · [ws](https://github.com/websockets/ws)

## Scripts

### Frontend

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR on port 8080 |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |

### Backend

| Command | Description |
|---|---|
| `npm run dev` | Dev server with auto-reload (`ts-node-dev`) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run the compiled server |

