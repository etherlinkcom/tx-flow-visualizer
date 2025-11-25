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
    <Card className="p-6 bg-card/50 border-border">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Blocks</h2>
        <span className="text-sm text-muted-foreground">
          {blocks.length} blocks
        </span>
      </div>
      <div className="space-y-2 max-h-[360px] overflow-y-auto pr-2">
        {blocks.map((block) => (
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
    </Card>
  );
};
