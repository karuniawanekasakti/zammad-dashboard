import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";

interface Props {
  title: string;
  value: ReactNode;
  helper?: ReactNode;
  icon?: React.ElementType;
  iconClassName?: string;
  trend?: { value: number; direction: "up" | "down"; goodIs?: "up" | "down" };
}

export function KpiCard({ title, value, helper, icon: Icon, iconClassName, trend }: Props) {
  const trendGood =
    trend &&
    ((trend.goodIs ?? "up") === "up" ? trend.direction === "up" : trend.direction === "down");

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</div>
          <div className="text-2xl font-bold leading-tight">{value}</div>
          {helper && <div className="text-xs text-muted-foreground">{helper}</div>}
        </div>
        {Icon && (
          <div className={cn("flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary", iconClassName)}>
            <Icon className="size-4" />
          </div>
        )}
      </div>
      {trend && (
        <div
          className={cn(
            "mt-3 inline-flex items-center gap-1 text-xs font-medium",
            trendGood ? "text-emerald-500" : "text-destructive"
          )}
        >
          {trend.direction === "up" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
          {Math.abs(trend.value).toFixed(1)}% vs prior period
        </div>
      )}
    </Card>
  );
}
