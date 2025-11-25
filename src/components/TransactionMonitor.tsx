import { useState, useEffect, useCallback, useRef } from "react";
import { TransactionItem } from "./TransactionItem";
import { BlockColumn } from "./BlockColumn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Transaction {
  id: string;
  hash: string;
  isValidated: boolean;
  shouldExit: boolean;
  timestamp: number;
}

interface Block {
  id: number;
  isValidated: boolean;
  transactionCount: number;
}

type StreamKey = "included" | "receipts" | "heads";
type StreamStatus = "connecting" | "connected" | "disconnected" | "error";

const parseTxHash = (payload: unknown): string | null => {
  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload === "object" && payload !== null) {
    if ("result" in payload) {
      return parseTxHash((payload as { result?: unknown }).result);
    }

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [status, setStatus] = useState<Record<StreamKey, StreamStatus>>({
    included: "disconnected",
    receipts: "disconnected",
    heads: "disconnected",
  });
  const [lastHead, setLastHead] = useState<Record<string, unknown> | null>(null);
  const [page, setPage] = useState(1);

  const addTransaction = useCallback((hash: string) => {
    setTransactions(prev => [
      ...prev,
      {
        id: `${hash}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        hash,
        isValidated: false,
        shouldExit: false,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const validateTransaction = useCallback((hash: string) => {
    setTransactions(prev => {
      const index = prev.findIndex(tx => tx.hash === hash && !tx.isValidated);
      if (index === -1) {
        return prev;
      }

      const updated = [...prev];
      updated[index] = { ...updated[index], isValidated: true };
      return updated;
    });
  }, []);
  useEffect(() => {
    if (
      transactions.length > 0 &&
      transactions.every(tx => tx.isValidated) &&
      transactions.some(tx => !tx.shouldExit)
    ) {
      setTransactions(prev => prev.map(tx => ({ ...tx, shouldExit: true })));
      
      // Add validated block
      setBlocks(prev => {
        const newBlock: Block = {
          id: page,
          isValidated: false,
          transactionCount: transactions.length,
        };
        return [...prev, newBlock];
      });
      
      // Validate block after squeeze animation
      setTimeout(() => {
        setBlocks(prev => 
          prev.map(b => b.id === page ? { ...b, isValidated: true } : b)
        );
      }, 700);
    }
  }, [transactions, page]);

  // Auto-scroll when last transaction slides in
  useEffect(() => {
    if (transactions.length > 0 && scrollRef.current) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [transactions.length]);

  useEffect(() => {
    if (!streamEndpoint) {
      setStatus({ included: "error", receipts: "error", heads: "error" });
      setPage(1);
      setBlocks([]);
      setLastHead(null);
      setTransactions([]);
      return;
    }

    const subscribe = (
      stream: StreamKey,
      params: [string],
      onResult: (payload: unknown) => void
    ) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(streamEndpoint);
      } catch (error) {
        console.error(`Failed to create WebSocket for ${stream}`, error);
        setStatus(prev => ({ ...prev, [stream]: "error" }));
        return () => {};
      }
      let isActive = true;

      setStatus(prev => ({ ...prev, [stream]: "connecting" }));

      const sendSubscribe = () => {
        if (!isActive || socket.readyState !== WebSocket.OPEN) return;
        try {
          const requestId = requestIdRef.current++;
          const payload = {
            jsonrpc: "2.0",
            id: requestId,
            method: "eth_subscribe",
            params,
          };
          socket.send(JSON.stringify(payload));
        } catch (error) {
          console.error(`Failed to subscribe to ${stream}`, error);
          setStatus(prev => ({ ...prev, [stream]: "error" }));
        }
      };

      socket.addEventListener("open", () => {
        setStatus(prev => ({ ...prev, [stream]: "connected" }));
        sendSubscribe();
      });

      // In some environments the socket can already be open (or transition quickly)
      // before the event listener is attached; try to subscribe immediately too.
      if (socket.readyState === WebSocket.OPEN) {
        setStatus(prev => ({ ...prev, [stream]: "connected" }));
        sendSubscribe();
      }

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

      socket.onerror = (event) => {
        console.error(`WebSocket error on ${stream}`, event);
        setStatus(prev => ({ ...prev, [stream]: "error" }));
      };

      socket.onclose = (event) => {
        console.warn(
          `WebSocket closed on ${stream}`,
          { code: event.code, reason: event.reason, wasClean: event.wasClean }
        );
        setStatus(prev => ({ ...prev, [stream]: "disconnected" }));
      };

      return () => {
        isActive = false;
        socket.close();
      };
    };

    const unsubscribeIncluded = subscribe("included", ["tez_newIncludedTransactions"], (payload) => {
      const hash = parseTxHash(payload);
      if (hash) {
        addTransaction(hash);
      }
    });

    const unsubscribeReceipts = subscribe("receipts", ["tez_newPreconfirmedReceipts"], (payload) => {
      const hash = parseTxHash(payload);
      if (hash) {
        validateTransaction(hash);
      }
    });

    const unsubscribeHeads = subscribe("heads", ["newHeads"], (payload) => {
      if (typeof payload === "object" && payload !== null) {
        setLastHead(payload as Record<string, unknown>);
      } else {
        setLastHead({ raw: payload });
      }

      const blockNumberHex =
        typeof payload === "object" &&
        payload !== null &&
        "number" in payload &&
        typeof (payload as { number?: unknown }).number === "string"
          ? (payload as { number: string }).number
          : undefined;

      const blockId = blockNumberHex ? parseInt(blockNumberHex, 16) : undefined;
      const txCount =
        typeof payload === "object" &&
        payload !== null &&
        "transactions" in payload &&
        Array.isArray((payload as { transactions?: unknown }).transactions)
          ? ((payload as { transactions: unknown[] }).transactions.length ?? 0)
          : 0;

      setPage(prev => (blockId ? blockId : prev + 1));
      setTransactions(prev => prev.map(tx => ({ ...tx, shouldExit: true })));
      setBlocks(prev => [
        {
          id: blockId ?? prev.length + 1,
          isValidated: true,
          transactionCount: txCount,
        },
        ...prev,
      ]);
    });

    return () => {
      unsubscribeIncluded?.();
      unsubscribeReceipts?.();
      unsubscribeHeads?.();
    };
  }, [streamEndpoint, addTransaction, validateTransaction]);

  const handleAnimationComplete = useCallback((id: string) => {
    setTransactions(prev => prev.filter(tx => tx.id !== id));
  }, []);

  const includedActive = status.included === "connected";
  const receiptsActive = status.receipts === "connected";
  const headsActive = status.heads === "connected";

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 text-foreground tx-glow-cyan">
            Ethereum Transaction Monitor
          </h1>
          <p className="text-muted-foreground">Real-time pre-confirmations tracking • Block {page}</p>
          
          <div className="flex flex-wrap gap-3 mt-4">
            <Badge 
              variant={includedActive ? "default" : "secondary"}
              className={includedActive ? "bg-tx-pending text-primary-foreground" : ""}
            >
              Included tx stream: {status.included}
            </Badge>
            <Badge 
              variant={receiptsActive ? "default" : "secondary"}
              className={receiptsActive ? "bg-tx-validated text-secondary-foreground" : ""}
            >
              Receipt stream: {status.receipts}
            </Badge>
            <Badge 
              variant={headsActive ? "default" : "secondary"}
              className={headsActive ? "bg-primary text-primary-foreground" : ""}
            >
              Block stream: {status.heads}
            </Badge>
          </div>
          {!streamEndpoint && (
            <p className="text-sm text-destructive mt-3">
              Configure <code className="font-mono">VITE_TEZOS_WS_URL</code> with a JSON-RPC WebSocket endpoint to see live data.
            </p>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <BlockColumn blocks={blocks} />
          
          <Card className="p-6 bg-card/50 border-border">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">
                Active Transactions
              </h2>
              <span className="text-sm text-muted-foreground">
                {transactions.length} active transactions
              </span>
            </div>

            <div
              ref={scrollRef}
              className="space-y-2 max-h-[360px] overflow-y-auto pr-2"
            >
              {transactions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="mb-2">No transactions yet</p>
                  <p className="text-sm">Waiting for incoming transactions...</p>
                </div>
              ) : (
                transactions.map((tx) => (
                  <TransactionItem
                    key={tx.id}
                    hash={tx.hash}
                    isValidated={tx.isValidated}
                    shouldExit={tx.shouldExit}
                    onAnimationComplete={() => handleAnimationComplete(tx.id)}
                  />
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>
            Connected to WebSocket streams • Monitoring eth_subscribe events for tez_newIncludedTransactions, tez_newPreconfirmedReceipts, and newHeads
          </p>
        </div>
      </div>
    </div>
  );
};
