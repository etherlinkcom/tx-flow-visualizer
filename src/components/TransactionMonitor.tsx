import { useState, useEffect, useCallback, useRef } from "react";
import { TransactionItem } from "./TransactionItem";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Transaction {
  hash: string;
  isValidated: boolean;
  shouldExit: boolean;
  timestamp: number;
}

type StreamKey = "stream1" | "stream2";
type StreamStatus = "connecting" | "connected" | "disconnected" | "error" | "no-url";

const parseTxHash = (payload: unknown): string | null => {
  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload === "object" && payload !== null) {
    const candidate =
      (payload as Record<string, unknown>).hash ??
      (payload as Record<string, unknown>).transactionHash ??
      (payload as Record<string, unknown>).tx_hash ??
      (payload as Record<string, unknown>).txHash;

    return typeof candidate === "string" ? candidate : null;
  }

  return null;
};

export const TransactionMonitor = () => {
  const streamEndpoint = import.meta.env.VITE_TEZOS_WS_URL;
  const requestIdRef = useRef(1);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [status, setStatus] = useState<Record<StreamKey, StreamStatus>>({
    stream1: "disconnected",
    stream2: "disconnected",
  });

  useEffect(() => {
    if (!streamEndpoint) {
      setStatus({ stream1: "no-url", stream2: "no-url" });
      return;
    }

    const subscribe = (
      stream: StreamKey,
      params: [string],
      onResult: (payload: unknown) => void
    ) => {
      const socket = new WebSocket(streamEndpoint);

      setStatus(prev => ({ ...prev, [stream]: "connecting" }));

      socket.onopen = () => {
        setStatus(prev => ({ ...prev, [stream]: "connected" }));
        const requestId = requestIdRef.current++;

        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method: "eth_subscribe",
            params,
          })
        );
      };

      socket.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          console.warn(`Malformed payload on ${stream}:`, error);
          return;
        }

        if (
          typeof payload === "object" &&
          payload !== null &&
          "method" in payload &&
          (payload as { method?: string }).method === "eth_subscription"
        ) {
          const paramsPayload = (payload as { params?: { result?: unknown } }).params;
          if (paramsPayload && "result" in paramsPayload) {
            onResult(paramsPayload.result);
          }
        }
      };

      socket.onerror = () => {
        setStatus(prev => ({ ...prev, [stream]: "error" }));
      };

      socket.onclose = () => {
        setStatus(prev => ({ ...prev, [stream]: "disconnected" }));
      };

      return socket;
    };

    const hashSocket = subscribe("stream1", ["tez_newIncludedTransactions"], (payload) => {
      const hash = parseTxHash(payload);
      if (!hash) {
        return;
      }

      setTransactions(prev => {
        if (prev.some(tx => tx.hash === hash)) {
          return prev;
        }

        return [
          ...prev,
          {
            hash,
            isValidated: false,
            shouldExit: false,
            timestamp: Date.now(),
          },
        ];
      });
    });

    const receiptSocket = subscribe("stream2", ["tez_newPreconfirmedReceipts"], (payload) => {
      const hash = parseTxHash(payload);
      if (!hash) {
        return;
      }

      setTransactions(prev =>
        prev.map(tx =>
          tx.hash === hash
            ? { ...tx, isValidated: true, shouldExit: true }
            : tx
        )
      );
    });

    return () => {
      hashSocket?.close();
      receiptSocket?.close();
    };
  }, [streamEndpoint]);

  const handleAnimationComplete = useCallback((hash: string) => {
    setTransactions(prev => prev.filter(tx => tx.hash !== hash));
  }, []);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 text-foreground tx-glow-cyan">
            Ethereum Transaction Monitor
          </h1>
          <p className="text-muted-foreground">Real-time blockchain transaction tracking</p>
          
          <div className="flex gap-3 mt-4">
            <Badge 
              variant={status.stream1 === "connected" ? "default" : "secondary"}
              className={status.stream1 === "connected" ? "bg-tx-pending text-primary-foreground" : ""}
            >
              Stream 1: {status.stream1}
            </Badge>
            <Badge 
              variant={status.stream2 === "connected" ? "default" : "secondary"}
              className={status.stream2 === "connected" ? "bg-tx-validated text-secondary-foreground" : ""}
            >
              Stream 2: {status.stream2}
            </Badge>
          </div>
          {!streamEndpoint && (
            <p className="text-sm text-destructive mt-3">
              Configure <code className="font-mono">VITE_TEZOS_WS_URL</code> to establish both eth_subscribe streams.
            </p>
          )}
        </div>

        <Card className="p-6 bg-card/50 border-border">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">
              Transaction Pool
            </h2>
            <span className="text-sm text-muted-foreground">
              {transactions.length} active transactions
            </span>
          </div>

          <div className="space-y-2 overflow-hidden">
            {transactions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="mb-2">No transactions yet</p>
                <p className="text-sm">Waiting for incoming transactions...</p>
              </div>
            ) : (
              transactions.map((tx) => (
                <TransactionItem
                  key={tx.hash}
                  hash={tx.hash}
                  isValidated={tx.isValidated}
                  shouldExit={tx.shouldExit}
                  onAnimationComplete={() => handleAnimationComplete(tx.hash)}
                />
              ))
            )}
          </div>
        </Card>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>
            Connected to WebSocket streams • Monitoring eth_subscribe events
          </p>
        </div>
      </div>
    </div>
  );
};
