import { useState, useEffect, useCallback } from "react";
import { TransactionItem } from "./TransactionItem";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Transaction {
  hash: string;
  isValidated: boolean;
  shouldExit: boolean;
  timestamp: number;
}

export const TransactionMonitor = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ws1, setWs1] = useState<WebSocket | null>(null);
  const [ws2, setWs2] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState({ stream1: "disconnected", stream2: "disconnected" });

  useEffect(() => {
    // Simulated WebSocket connections
    // In production, replace with actual eth_subscribe WebSocket URLs
    
    // Stream 1: Transaction hashes and timestamps
    const socket1 = new WebSocket("wss://echo.websocket.org");
    socket1.onopen = () => {
      setStatus(prev => ({ ...prev, stream1: "connected" }));
      console.log("Stream 1 connected");
      
      // Simulate incoming transactions
      const interval = setInterval(() => {
        const hash = `0x${Math.random().toString(16).substring(2, 66)}`;
        socket1.send(JSON.stringify({ type: "tx", hash }));
      }, 3000);

      // Simulate timestamp events
      const timestampInterval = setInterval(() => {
        socket1.send(JSON.stringify({ type: "timestamp", value: Date.now() }));
      }, 15000);

      return () => {
        clearInterval(interval);
        clearInterval(timestampInterval);
      };
    };

    socket1.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === "tx" && data.hash) {
          setTransactions(prev => [
            ...prev,
            {
              hash: data.hash,
              isValidated: false,
              shouldExit: false,
              timestamp: Date.now(),
            }
          ]);
        } else if (data.type === "timestamp") {
          // Mark all transactions to exit
          setTransactions(prev =>
            prev.map(tx => ({ ...tx, shouldExit: true }))
          );
        }
      } catch (error) {
        // Echo server sends back raw messages, this is expected
      }
    };

    socket1.onerror = () => setStatus(prev => ({ ...prev, stream1: "error" }));
    socket1.onclose = () => setStatus(prev => ({ ...prev, stream1: "disconnected" }));

    // Stream 2: Receipts
    const socket2 = new WebSocket("wss://echo.websocket.org");
    socket2.onopen = () => {
      setStatus(prev => ({ ...prev, stream2: "connected" }));
      console.log("Stream 2 connected");
    };

    socket2.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === "receipt" && data.hash) {
          setTransactions(prev =>
            prev.map(tx =>
              tx.hash === data.hash
                ? { ...tx, isValidated: true }
                : tx
            )
          );
        }
      } catch (error) {
        // Echo server sends back raw messages, this is expected
      }
    };

    socket2.onerror = () => setStatus(prev => ({ ...prev, stream2: "error" }));
    socket2.onclose = () => setStatus(prev => ({ ...prev, stream2: "disconnected" }));

    setWs1(socket1);
    setWs2(socket2);

    return () => {
      socket1.close();
      socket2.close();
    };
  }, []);

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
