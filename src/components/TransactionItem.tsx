import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface TransactionItemProps {
  hash: string;
  isValidated: boolean;
  shouldExit: boolean;
  onAnimationComplete?: () => void;
}

export const TransactionItem = ({ 
  hash, 
  isValidated, 
  shouldExit,
  onAnimationComplete 
}: TransactionItemProps) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (shouldExit) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        onAnimationComplete?.();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [shouldExit, onAnimationComplete]);

  return (
    <Card
      className={cn(
        "p-2 border rounded-lg transition-all duration-500 shadow-sm",
        isExiting && "animate-slide-out",
        !isExiting && "animate-slide-in",
        isValidated 
          ? "border-tx-validated bg-card/40"
          : "border-border bg-background"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full animate-pulse-glow",
              isValidated ? "bg-tx-validated" : "bg-tx-pending"
            )}
          />
          <code
            className={cn(
              "text-xs font-mono transition-all duration-500",
              isValidated 
                ? "text-tx-validated font-semibold" 
                : "text-foreground"
            )}
          >
            {hash}
          </code>
        </div>
      </div>
    </Card>
  );
};
