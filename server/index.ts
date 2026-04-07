/**
 * TX Flow Visualizer – Unified Server
 *
 * Architecture
 * ────────────
 *   Browser 1 ──┐
 *   Browser 2 ──┤──► this server (HTTP + WebSocket) ──► EVM node
 *   Browser N ──┘
 *
 * This single Node.js process:
 *   1. Serves the compiled React frontend from ./dist/
 *   2. Maintains 3 persistent WebSocket connections to the EVM node (one per
 *      subscription stream) and fans out events to all subscribed browser
 *      clients.
 *
 * The EVM node URL (TEZOS_WS_URL) is a server-side env variable and is
 * never exposed to browsers.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

// ── configuration ──────────────────────────────────────────────────────────

const _rawPort = Number(process.env.PORT ?? 8080);
const PORT =
  Number.isInteger(_rawPort) && _rawPort > 0 && _rawPort <= 65535
    ? _rawPort
    : (() => {
        console.warn("[server] Invalid PORT value; defaulting to 8080");
        return 8080;
      })();

/** The private EVM WebSocket endpoint – never sent to the browser. */
const EVM_WS_URL = process.env.TEZOS_WS_URL;

/** How long to wait before retrying a dropped upstream connection (ms). */
const _rawDelay = Number(process.env.RECONNECT_DELAY_MS ?? 3000);
const RECONNECT_DELAY_MS =
  Number.isFinite(_rawDelay) && _rawDelay >= 0
    ? _rawDelay
    : (() => {
        console.warn(
          "[server] Invalid RECONNECT_DELAY_MS value; defaulting to 3000"
        );
        return 3000;
      })();

/** Optional comma-separated list of allowed frontend origins, e.g.
 *  "https://stream.proofofspeed.xyz"
 *  Leave unset to allow all origins (useful during local development). */
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()))
  : null;

/** Absolute path to the compiled frontend assets. */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "../dist");

// ── sanity-check ───────────────────────────────────────────────────────────

if (!EVM_WS_URL) {
  console.error(
    "[server] TEZOS_WS_URL is not set. " +
      "Copy .env.example to .env and fill in the value."
  );
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the URL with any user-info (credentials) stripped out so it is
 * safe to print in logs.
 */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "(invalid URL)";
  }
}

/** Shape of the upstream subscribe acknowledgement we expect from the EVM node. */
interface JsonRpcSubscribeAck {
  id: number;
  result: string;
}

function isSubscribeAck(msg: unknown): msg is JsonRpcSubscribeAck {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).id === 1 &&
    typeof (msg as Record<string, unknown>).result === "string"
  );
}

/** Basic MIME type map for the Vite-generated frontend assets. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve a static file from DIST_DIR.  Resolves index.html for any path that
 * does not correspond to an existing file (SPA fallback).
 *
 * Guards against path-traversal by resolving the full absolute path and
 * verifying it stays within DIST_DIR before any file I/O.
 */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const urlPath = req.url?.split("?")[0] ?? "/";
  // path.resolve normalises all segment types including "..", so we never
  // need regex manipulation.  We then verify containment before touching disk.
  const candidate = path.resolve(DIST_DIR, "." + urlPath);

  // Path traversal guard: resolved path must still be inside DIST_DIR
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Try the file as-is, then with /index.html, then fall back to root index.html
  const candidates = [
    candidate,
    path.join(candidate, "index.html"),
    path.join(DIST_DIR, "index.html"),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      // Cache static assets aggressively (fingerprinted filenames); never
      // cache the SPA entry point.
      const isEntryPoint = filePath === path.join(DIST_DIR, "index.html");
      const cacheControl = isEntryPoint
        ? "no-cache, no-store, must-revalidate"
        : "public, max-age=31536000, immutable";

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  res.writeHead(404);
  res.end("Not found");
}

// ── stream registry ────────────────────────────────────────────────────────

/** The three EVM subscription streams this server manages. */
const STREAM_NAMES = [
  "tez_newIncludedTransactions",
  "tez_newPreconfirmedReceipts",
  "newHeads",
] as const;

type StreamName = (typeof STREAM_NAMES)[number];

/**
 * For each stream: the set of browser WebSocket connections currently
 * subscribed to it.
 */
const subscribers = new Map<StreamName, Set<WebSocket>>(
  STREAM_NAMES.map((name) => [name, new Set()])
);

/** Live status of each upstream connection (for the health-check endpoint). */
const upstreamStatus = new Map<
  StreamName,
  "connecting" | "connected" | "disconnected"
>(STREAM_NAMES.map((name) => [name, "connecting"]));

/**
 * The real subscription ID returned by the EVM node for each stream.
 * Stored when the upstream subscribe ack arrives so we can hand the same ID
 * to every browser client that subscribes to that stream.
 */
const upstreamSubIds = new Map<StreamName, string | null>(
  STREAM_NAMES.map((name) => [name, null])
);

// ── HTTP server (static files + health-check) ──────────────────────────────

const httpServer = http.createServer((req, res) => {
  const url = req.url ?? "/";

  // Health check / status endpoint
  if (url === "/health" || url === "/health/") {
    const subscriberCounts = Object.fromEntries(
      [...subscribers.entries()].map(([stream, set]) => [stream, set.size])
    );
    const upstream = Object.fromEntries(upstreamStatus.entries());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", upstream, subscribers: subscriberCounts }));
    return;
  }

  // Serve the compiled React frontend for all other requests
  serveStatic(req, res);
});

// ── WebSocket server (accepts browser clients) ─────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (clientWs: WebSocket, req: http.IncomingMessage) => {
  // ── origin check ─────────────────────────────────────────────────────────
  // req.headers["origin"] can be string | string[] | undefined; normalise to string.
  const rawOrigin = req.headers["origin"];
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] ?? "" : rawOrigin ?? "";
  if (ALLOWED_ORIGINS && !ALLOWED_ORIGINS.has(origin)) {
    console.warn(`[server] Rejected connection from disallowed origin: ${origin}`);
    clientWs.close(1008, "Origin not allowed");
    return;
  }

  console.log(`[server] Client connected (origin: ${origin || "unknown"})`);

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

    // If the upstream subscription ID is not yet available (e.g. the EVM node
    // is still connecting after a reconnect), reject the subscription so the
    // client gets a clear error rather than a mismatched ID.
    const subId = upstreamSubIds.get(stream);
    if (subId === null) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32603,
              message: `Stream ${stream} is not yet connected; please retry`,
            },
          })
        );
      }
      return;
    }

    subscribers.get(stream)!.add(clientWs);

    // Return the actual upstream subscription ID so the client's subscription
    // ID matches the `params.subscription` field in forwarded notifications.
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({ jsonrpc: "2.0", id: requestId, result: subId })
      );
    }

    console.log(
      `[server] Client subscribed to stream: ${stream} ` +
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
    console.log("[server] Client disconnected");
  });

  clientWs.on("error", (err) => {
    console.error(`[server] Client error: ${err.message}`);
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

    console.log(`[server] Connecting upstream for stream: ${streamName}`);
    upstreamStatus.set(streamName, "connecting");

    try {
      socket = new WebSocket(EVM_WS_URL as string);
    } catch (err) {
      console.error(
        `[server] Failed to create upstream socket for ${streamName}:`,
        err
      );
      scheduleReconnect();
      return;
    }

    socket.on("open", () => {
      console.log(`[server] Upstream connected for stream: ${streamName}`);
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
      // Intercept the upstream subscribe acknowledgement (id: 1) so we can
      // record the real subscription ID and avoid forwarding it to browsers.
      if (!isBinary) {
        try {
          const parsed: unknown = JSON.parse(data.toString());
          if (isSubscribeAck(parsed)) {
            upstreamSubIds.set(streamName, parsed.result);
            console.log(
              `[server] Upstream sub ID for ${streamName}: ${parsed.result}`
            );
            return; // Don't forward the subscribe ack to browser clients
          }
        } catch {
          // Non-JSON frame – fall through and broadcast
        }
      }

      // Broadcast all other messages (eth_subscription notifications) to
      // every client subscribed to this stream.
      const clients = subscribers.get(streamName)!;
      for (const clientWs of clients) {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      }
    });

    socket.on("error", (err) => {
      console.error(`[server] Upstream error for ${streamName}: ${err.message}`);
    });

    socket.on("close", (code) => {
      upstreamStatus.set(streamName, "disconnected");
      upstreamSubIds.set(streamName, null); // will be repopulated on reconnect
      console.warn(
        `[server] Upstream closed for ${streamName} (code: ${code}). ` +
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
  console.log(`[server] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] Serving frontend from: ${DIST_DIR}`);
  console.log(`[server] Upstream EVM node: ${redactUrl(EVM_WS_URL as string)}`);
  console.log(`[server] Streams: ${STREAM_NAMES.join(", ")}`);
  if (ALLOWED_ORIGINS) {
    console.log(`[server] Allowed origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
  } else {
    console.log("[server] All origins allowed (set ALLOWED_ORIGINS to restrict)");
  }
});

// ── graceful shutdown ──────────────────────────────────────────────────────

const shutdown = () => {
  console.log("[server] Shutting down…");
  teardowns.forEach((td) => td());
  wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));
  httpServer.close(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
