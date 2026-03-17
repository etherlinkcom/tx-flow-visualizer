/**
 * TX Flow Visualizer – Fan-out WebSocket Broadcast Backend
 *
 * Architecture
 * ────────────
 *   Browser 1 ──┐
 *   Browser 2 ──┤──► backend (this server) ──► EVM node (single shared connection per stream)
 *   Browser N ──┘
 *
 * The backend maintains exactly 3 persistent upstream WebSocket connections to the
 * EVM node – one for each subscription stream.  All browser clients share those
 * connections: EVM events are fanned out to every client subscribed to the
 * relevant stream.  This means N clients cause 3 upstream connections total,
 * not 3×N.
 *
 * The EVM node URL (TEZOS_WS_URL) is a server-side env variable and is never
 * sent to browsers.  No frontend changes are required – the existing
 * eth_subscribe / eth_subscription protocol is preserved.
 */

import http from "http";
import { WebSocket, WebSocketServer } from "ws";

// ── configuration ──────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);

/** The private EVM WebSocket endpoint – never sent to the browser. */
const EVM_WS_URL = process.env.TEZOS_WS_URL;

/** How long to wait before retrying a dropped upstream connection (ms). */
const RECONNECT_DELAY_MS = Number(process.env.RECONNECT_DELAY_MS ?? 3000);

/** Optional comma-separated list of allowed frontend origins, e.g.
 *  "http://localhost:8080,https://stream.proofofspeed.xyz"
 *  Leave unset to allow all origins (useful during local development). */
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()))
  : null;

// ── sanity-check ───────────────────────────────────────────────────────────

if (!EVM_WS_URL) {
  console.error(
    "[broadcast] TEZOS_WS_URL is not set. " +
      "Copy backend/.env.example to backend/.env and fill in the value."
  );
  process.exit(1);
}

// ── stream registry ────────────────────────────────────────────────────────

/** The three EVM subscription streams this backend manages. */
const STREAM_NAMES = [
  "tez_newIncludedTransactions",
  "tez_newPreconfirmedReceipts",
  "newHeads",
] as const;

type StreamName = (typeof STREAM_NAMES)[number];

/**
 * For each stream: the set of browser WebSocket connections currently
 * subscribed to it.  Events received from the EVM node are fanned out to
 * every member of this set.
 */
const subscribers = new Map<StreamName, Set<WebSocket>>(
  STREAM_NAMES.map((name) => [name, new Set()])
);

/** Live status of each upstream connection (for the health-check endpoint). */
const upstreamStatus = new Map<StreamName, "connecting" | "connected" | "disconnected">(
  STREAM_NAMES.map((name) => [name, "connecting"])
);

// ── HTTP server (health-check) ─────────────────────────────────────────────

const httpServer = http.createServer((_req, res) => {
  const subscriberCounts = Object.fromEntries(
    [...subscribers.entries()].map(([stream, set]) => [stream, set.size])
  );
  const upstream = Object.fromEntries(upstreamStatus.entries());
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", upstream, subscribers: subscriberCounts }));
});

// ── WebSocket server (accepts browser clients) ─────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (clientWs: WebSocket, req: http.IncomingMessage) => {
  // ── origin check ─────────────────────────────────────────────────────────
  const origin = req.headers["origin"] ?? "";
  if (ALLOWED_ORIGINS && !ALLOWED_ORIGINS.has(origin)) {
    console.warn(`[broadcast] Rejected connection from disallowed origin: ${origin}`);
    clientWs.close(1008, "Origin not allowed");
    return;
  }

  console.log(`[broadcast] Client connected (origin: ${origin || "unknown"})`);

  // ── handle eth_subscribe requests from the browser ───────────────────────
  clientWs.on("message", (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // ignore non-JSON frames
    }

    if (
      typeof msg !== "object" ||
      msg === null ||
      (msg as Record<string, unknown>)["method"] !== "eth_subscribe"
    ) {
      return; // ignore anything that isn't an eth_subscribe call
    }

    const { id: requestId, params } = msg as {
      id: unknown;
      params?: unknown[];
    };

    const streamName = Array.isArray(params) ? params[0] : undefined;

    if (!STREAM_NAMES.includes(streamName as StreamName)) {
      // Unknown stream – send a JSON-RPC error so the client isn't left hanging
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            error: { code: -32602, message: `Unknown stream: ${streamName}` },
          })
        );
      }
      return;
    }

    const stream = streamName as StreamName;
    subscribers.get(stream)!.add(clientWs);

    // Acknowledge the subscription with a stable per-client ID.
    // The frontend doesn't use subscription IDs, but sending a valid response
    // keeps the JSON-RPC contract intact.
    const fakeSubId =
      "0x" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");

    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({ jsonrpc: "2.0", id: requestId, result: fakeSubId })
      );
    }

    console.log(
      `[broadcast] Client subscribed to stream: ${stream} ` +
        `(${subscribers.get(stream)!.size} total subscriber(s))`
    );
  });

  // ── teardown ──────────────────────────────────────────────────────────────
  const removeClient = () => {
    for (const set of subscribers.values()) {
      set.delete(clientWs);
    }
  };

  clientWs.on("close", () => {
    removeClient();
    console.log("[broadcast] Client disconnected");
  });

  clientWs.on("error", (err) => {
    console.error(`[broadcast] Client error: ${err.message}`);
    removeClient();
  });
});

// ── upstream connection manager ────────────────────────────────────────────

/**
 * Opens a persistent WebSocket connection to the EVM node for `streamName`,
 * sends the eth_subscribe request, and fans out received events to all
 * subscribed browser clients.  Reconnects automatically if the connection
 * drops.  Returns a teardown function.
 */
function connectUpstream(streamName: StreamName): () => void {
  let destroyed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (destroyed) return;

    console.log(`[broadcast] Connecting upstream for stream: ${streamName}`);
    upstreamStatus.set(streamName, "connecting");

    try {
      socket = new WebSocket(EVM_WS_URL as string);
    } catch (err) {
      console.error(
        `[broadcast] Failed to create upstream socket for ${streamName}:`,
        err
      );
      scheduleReconnect();
      return;
    }

    socket.on("open", () => {
      console.log(`[broadcast] Upstream connected for stream: ${streamName}`);
      upstreamStatus.set(streamName, "connected");

      // Subscribe to the stream
      socket!.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: [streamName],
        })
      );
    });

    socket.on("message", (data, isBinary) => {
      // Broadcast to every client subscribed to this stream
      const clients = subscribers.get(streamName)!;
      for (const clientWs of clients) {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      }
    });

    socket.on("error", (err) => {
      console.error(`[broadcast] Upstream error for ${streamName}: ${err.message}`);
    });

    socket.on("close", (code) => {
      upstreamStatus.set(streamName, "disconnected");
      console.warn(
        `[broadcast] Upstream closed for ${streamName} (code: ${code}). ` +
          `Reconnecting in ${RECONNECT_DELAY_MS} ms…`
      );
      socket = null;
      scheduleReconnect();
    });
  };

  const scheduleReconnect = () => {
    if (destroyed) return;
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };

  const teardown = () => {
    destroyed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (socket !== null) socket.close();
  };

  connect();
  return teardown;
}

// Start all 3 upstream connections at server startup
const teardowns = STREAM_NAMES.map(connectUpstream);

// ── start ──────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[broadcast] WebSocket broadcast server listening on ws://0.0.0.0:${PORT}`);
  console.log(`[broadcast] Upstream EVM node: ${EVM_WS_URL}`);
  console.log(`[broadcast] Streams: ${STREAM_NAMES.join(", ")}`);
  if (ALLOWED_ORIGINS) {
    console.log(`[broadcast] Allowed origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
  } else {
    console.log("[broadcast] All origins allowed (set ALLOWED_ORIGINS to restrict)");
  }
});

// ── graceful shutdown ──────────────────────────────────────────────────────

const shutdown = () => {
  console.log("[broadcast] Shutting down…");
  teardowns.forEach((td) => td());
  wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));
  httpServer.close(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
