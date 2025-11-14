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
        "p-4 mb-3 border transition-all duration-500",
        isExiting && "animate-slide-out",
        !isExiting && "animate-slide-in",
        isValidated 
          ? "border-tx-validated bg-card/50 card-glow-green" 
          : "border-tx-pending bg-card/30 card-glow-cyan"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-2 h-2 rounded-full animate-pulse-glow",
              isValidated ? "bg-tx-validated" : "bg-tx-pending"
            )}
          />
          <code
            className={cn(
              "text-sm font-mono transition-all duration-500",
              isValidated 
                ? "text-tx-validated tx-glow-green font-semibold" 
                : "text-tx-pending tx-glow-cyan"
            )}
          >
            {hash}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs px-2 py-1 rounded-full border transition-all duration-500",
              isValidated
                ? "border-tx-validated text-tx-validated bg-tx-validated/10"
                : "border-tx-pending text-tx-pending bg-tx-pending/10"
            )}
          >
            {isValidated ? "VALIDATED" : "PENDING"}
          </span>
        </div>
      </div>
    </Card>
  );
};
