/**
 * TX Flow Visualizer – WebSocket Proxy Backend
 *
 * This server sits between the browser frontend and the private EVM node.
 * The EVM node URL (TEZOS_WS_URL) is only visible server-side; the browser
 * only ever connects to this proxy.
 *
 * Each browser WebSocket connection triggers a corresponding upstream
 * connection to the EVM node.  All JSON-RPC frames are forwarded
 * transparently in both directions so the existing frontend code requires
 * no protocol changes.
 */

import http from "http";
import { WebSocket, WebSocketServer } from "ws";

// ── configuration ──────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);

/** The private EVM WebSocket endpoint – never sent to the browser. */
const EVM_WS_URL = process.env.TEZOS_WS_URL;

/** Optional comma-separated list of allowed frontend origins, e.g.
 *  "http://localhost:8080,https://stream.proofofspeed.xyz"
 *  Leave unset to allow all origins (useful during local development). */
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()))
  : null;

// ── sanity-check ───────────────────────────────────────────────────────────

if (!EVM_WS_URL) {
  console.error(
    "[proxy] TEZOS_WS_URL is not set. " +
      "Copy backend/.env.example to backend/.env and fill in the value."
  );
  process.exit(1);
}

// ── HTTP server ────────────────────────────────────────────────────────────

const httpServer = http.createServer((_req, res) => {
  // Simple health-check endpoint so load balancers / Docker health checks work.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

// ── WebSocket proxy server ─────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on(
  "connection",
  (frontendWs: WebSocket, request: http.IncomingMessage) => {
    // ── origin check ───────────────────────────────────────────────────────
    const origin = request.headers["origin"] ?? "";
    if (ALLOWED_ORIGINS && !ALLOWED_ORIGINS.has(origin)) {
      console.warn(`[proxy] Rejected connection from disallowed origin: ${origin}`);
      frontendWs.close(1008, "Origin not allowed");
      return;
    }

    console.log(`[proxy] New client connected (origin: ${origin || "unknown"})`);

    // ── upstream connection ────────────────────────────────────────────────
    let evmWs: WebSocket;
    try {
      evmWs = new WebSocket(EVM_WS_URL as string);
    } catch (err) {
      console.error("[proxy] Failed to create upstream connection:", err);
      frontendWs.close(1011, "Failed to connect to upstream");
      return;
    }

    // ── forward: frontend → EVM node ──────────────────────────────────────
    frontendWs.on("message", (data, isBinary) => {
      if (evmWs.readyState === WebSocket.OPEN) {
        evmWs.send(data, { binary: isBinary });
      }
    });

    // ── forward: EVM node → frontend ──────────────────────────────────────
    evmWs.on("message", (data, isBinary) => {
      if (frontendWs.readyState === WebSocket.OPEN) {
        frontendWs.send(data, { binary: isBinary });
      }
    });

    // ── upstream ready → relay any buffered subscription requests ─────────
    evmWs.on("open", () => {
      console.log("[proxy] Upstream EVM connection established");
    });

    // ── error handling ─────────────────────────────────────────────────────
    evmWs.on("error", (err) => {
      console.error("[proxy] Upstream error:", err.message);
      if (frontendWs.readyState === WebSocket.OPEN) {
        frontendWs.close(1011, "Upstream error");
      }
    });

    frontendWs.on("error", (err) => {
      console.error("[proxy] Client error:", err.message);
      if (evmWs.readyState === WebSocket.OPEN) {
        evmWs.close();
      }
    });

    // ── connection teardown ────────────────────────────────────────────────
    frontendWs.on("close", (code, reason) => {
      console.log(
        `[proxy] Client disconnected (code ${code}${reason.length ? `, reason: ${reason}` : ""})`
      );
      if (evmWs.readyState === WebSocket.OPEN) {
        evmWs.close();
      }
    });

    evmWs.on("close", (code, reason) => {
      console.log(
        `[proxy] Upstream closed (code ${code}${reason.length ? `, reason: ${reason}` : ""})`
      );
      if (frontendWs.readyState === WebSocket.OPEN) {
        frontendWs.close(1001, "Upstream closed");
      }
    });
  }
);

// ── start ──────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[proxy] WebSocket proxy listening on ws://0.0.0.0:${PORT}`);
  console.log(`[proxy] Upstream EVM node: ${EVM_WS_URL}`);
  if (ALLOWED_ORIGINS) {
    console.log(`[proxy] Allowed origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
  } else {
    console.log("[proxy] All origins allowed (set ALLOWED_ORIGINS to restrict)");
  }
});

// ── graceful shutdown ──────────────────────────────────────────────────────

const shutdown = () => {
  console.log("[proxy] Shutting down…");
  wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));
  httpServer.close(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
