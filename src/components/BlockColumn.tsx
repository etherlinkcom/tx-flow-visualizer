import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Block {
  id: number;
  isValidated: boolean;
  transactionCount: number;
}

interface BlockColumnProps {
  blocks: Block[];
}

export const BlockColumn = ({ blocks }: BlockColumnProps) => {
  return (
    <div className="w-32 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground mb-2">Blocks</h2>
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {blocks.map((block, index) => (
          <Card
            key={block.id}
            className={cn(
              "p-3 border-2 transition-all duration-700",
              block.isValidated
                ? "border-tx-validated bg-tx-validated/20 animate-squeeze-in"
                : "border-foreground bg-card/40"
            )}
          >
            <div className="text-center">
              <div
                className={cn(
                  "w-2 h-2 rounded-full mx-auto mb-2 animate-pulse-glow",
                  block.isValidated ? "bg-tx-validated" : "bg-foreground"
                )}
              />
              <div className="text-xs font-mono font-semibold text-foreground">
                #{block.id}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {block.transactionCount} txs
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
