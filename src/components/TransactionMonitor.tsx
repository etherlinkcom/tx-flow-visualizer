import { useState, useEffect, useCallback, useRef } from "react";
import { TransactionItem } from "./TransactionItem";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Transaction {
  id: string;
  hash: string;
  isValidated: boolean;
  shouldExit: boolean;
  timestamp: number;
}

type StreamKey = "included" | "receipts" | "heads";
type StreamStatus = "connecting" | "connected" | "disconnected" | "error" | "demo";

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

const DUMMY_TRANSACTION_HASH = "0x85d995eba9763907fdf35cd2034144dd9d53ce32cbec21349d4b12823c6860c5";

const DUMMY_RECEIPT = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    blockHash: "0xa957d47df264a31badc3ae823e10ac1d444b098d9b73d204c40426e57f47e8c3",
    blockNumber: "0xeff35f",
    contractAddress: null,
    cumulativeGasUsed: "0xa12515",
    effectiveGasPrice: "0x5a9c688d4",
    from: "0x6221a9c005f6e47eb398fd867784cacfdcfff4e7",
    gasUsed: "0xb4c8",
    logs: [
      {
        address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        topics: [
          "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
          "0x0000000000000000000000006221a9c005f6e47eb398fd867784cacfdcfff4e7",
          "0x0000000000000000000000001e0049783f008a0085193e00003d00cd54003c71",
        ],
        data: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        blockNumber: "0xeff35f",
        transactionHash: DUMMY_TRANSACTION_HASH,
        transactionIndex: "0x66",
        blockHash: "0xa957d47df264a31badc3ae823e10ac1d444b098d9b73d204c40426e57f47e8c3",
        logIndex: "0xfa",
        removed: false,
      },
    ],
    logsBloom:
      "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000080000000000000000200000000000000000000020000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020001000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000010200000000000000000000000000000000000000000000000000000020000",
    status: "0x1",
    to: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    transactionHash: DUMMY_TRANSACTION_HASH,
    transactionIndex: "0x66",
    type: "0x2",
  },
};

const DUMMY_RECEIPT_HASH = parseTxHash(DUMMY_RECEIPT) ?? DUMMY_TRANSACTION_HASH;

const DUMMY_NEW_HEAD = {
  number: "0xeff360",
  hash: "0x4f345f23546817bfc595cec7b98315f9ee0d2d16a07101e6f5c5a9ad9275d0bc",
  parentHash: "0x6db62144c816438b808bfad79243f44ed6c2f5d55bd5efd16ddbfa4938897d58",
  nonce: "0x0000000000000000",
  sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad313a1c75aecc08e5f8f4d3536aee5d9",
  logsBloom:
    "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000080000000000000000200000000000000000000020000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020001000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000010200000000000000000000000000000000000000000000000000000020000",
  transactionsRoot: "0xf0c2e5610de63853d5fae82d03a33951ff3ccd84589e25db94ec660d69a3b4da",
  stateRoot: "0xa8a9d0f1d4af2e5c77fbc917bc902b0faf6cb9d8ff0f0eb5e8a0a58d4a5730fb",
  receiptsRoot: "0x68d2bb0dacbb9dc0f2dd4ba3576c8cf6889d4a8da76c6cf10979f05de7975cdc",
  miner: "0x0000000000000000000000000000000000000000",
  difficulty: "0x0",
  totalDifficulty: null,
  extraData: "0x4c7578706c6f72652c20457468657265756d21",
  size: "0x1f90",
  gasLimit: "0x1c9c380",
  gasUsed: "0x12ab34",
  timestamp: "0x6521abcf",
  transactions: [DUMMY_TRANSACTION_HASH],
  uncles: [],
};

export const TransactionMonitor = () => {
  const streamEndpoint = import.meta.env.VITE_TEZOS_WS_URL;
  const requestIdRef = useRef(1);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
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
    }
  }, [transactions]);

  useEffect(() => {
    if (!streamEndpoint) {
      setStatus({ included: "demo", receipts: "demo", heads: "demo" });
      setPage(1);
      setLastHead(null);
      setTransactions([]);

      let intervalHandles: number[] = [];
      let timeoutHandles: number[] = [];

      const clearAll = () => {
        intervalHandles.forEach(clearInterval);
        timeoutHandles.forEach(clearTimeout);
        intervalHandles = [];
        timeoutHandles = [];
      };

      const startCycle = () => {
        clearAll();

        let txCount = 0;
        let receiptCount = 0;

        const txInterval = window.setInterval(() => {
          if (txCount >= 20) {
            clearInterval(txInterval);
            return;
          }

          addTransaction(DUMMY_TRANSACTION_HASH);
          txCount += 1;
        }, 10);
        intervalHandles.push(txInterval);

        const receiptInterval = window.setInterval(() => {
          if (receiptCount >= 10) {
            clearInterval(receiptInterval);

            const headTimeout = window.setTimeout(() => {
              setLastHead(DUMMY_NEW_HEAD);
              setPage(prev => prev + 1);

              const restartTimeout = window.setTimeout(() => {
                setTransactions([]);
                startCycle();
              }, 500);

              timeoutHandles.push(restartTimeout);
            }, 200);

            timeoutHandles.push(headTimeout);
            return;
          }

          validateTransaction(DUMMY_RECEIPT_HASH);
          receiptCount += 1;
        }, 40);
        intervalHandles.push(receiptInterval);
      };

      startCycle();

      return () => {
        clearAll();
      };
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

    const hashSocket = subscribe("included", ["tez_newIncludedTransactions"], (payload) => {
      const hash = parseTxHash(payload);
      if (hash) {
        addTransaction(hash);
      }
    });

    const receiptSocket = subscribe("receipts", ["tez_newPreconfirmedReceipts"], (payload) => {
      const hash = parseTxHash(payload);
      if (hash) {
        validateTransaction(hash);
      }
    });

    const headSocket = subscribe("heads", ["newHeads"], (payload) => {
      if (typeof payload === "object" && payload !== null) {
        setLastHead(payload as Record<string, unknown>);
      } else {
        setLastHead({ raw: payload });
      }

      setPage(prev => prev + 1);
      setTransactions(prev => prev.map(tx => ({ ...tx, shouldExit: true })));
    });

    return () => {
      hashSocket?.close();
      receiptSocket?.close();
      headSocket?.close();
    };
  }, [streamEndpoint, addTransaction, validateTransaction]);

  const handleAnimationComplete = useCallback((id: string) => {
    setTransactions(prev => prev.filter(tx => tx.id !== id));
  }, []);

  const includedActive = status.included === "connected" || status.included === "demo";
  const receiptsActive = status.receipts === "connected" || status.receipts === "demo";
  const headsActive = status.heads === "connected" || status.heads === "demo";

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
              Using demo stream data. Configure <code className="font-mono">VITE_TEZOS_WS_URL</code> to connect to a live node.
            </p>
          )}
        </div>

        <Card className="p-6 bg-card/50 border-border">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">
              Active Block
            </h2>
            <span className="text-sm text-muted-foreground">
              {transactions.length} active transactions
            </span>
          </div>

          <div
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

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>
            Connected to WebSocket streams • Monitoring eth_subscribe events for tez_newIncludedTransactions, tez_newPreconfirmedReceipts, and newHeads
          </p>
        </div>
      </div>
    </div>
  );
};
