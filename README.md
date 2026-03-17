# TX Flow Visualizer

Real-time Etherlink transaction flow monitor – pre-confirmation tracking visualised in the browser.

## Architecture

```
Browser (React/Vite)
        │  ws://backend-host:3001
        ▼
Backend WebSocket Proxy  (Node.js / backend/)
        │  ws://private-evm-node/ws   ← never exposed to the browser
        ▼
Private EVM Node
```

The **backend proxy** keeps the EVM node URL completely server-side.  The browser only ever connects to the proxy, so the private endpoint is never visible in network traffic or JavaScript bundles.

## Quick start (development)

### 1. Backend

```sh
cd backend
cp .env.example .env        # fill in TEZOS_WS_URL with the real EVM node URL
npm install
npm run dev                 # starts proxy on ws://localhost:3001
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
| `PORT` | `3001` | Port the proxy server listens on |
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

