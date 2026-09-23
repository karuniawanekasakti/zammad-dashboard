import { AlertCircle } from "lucide-react";
import { FlickerSpinner } from "flicker-dot";
import { cn } from "@/lib/utils";

const GRID_SIZE = 49;
const frames = [
  [16, 17, 21, 28],
  [16, 17, 18, 21],
  [16, 17, 18, 22],
  [17, 18, 22, 28],
  [18, 22, 27, 28],
  [22, 27, 28, 29],
  [20, 27, 28, 29],
  [14, 20, 27, 28],
].map((active) => Array.from({ length: GRID_SIZE }, (_, index) => active.includes(index)));

export function Spinner({ className, title = "Loading", size = 16 }: { className?: string; title?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center justify-center text-muted-foreground", className)} style={{ width: size, height: size }}>
      <FlickerSpinner grids={frames} variant="5x5" size={size} onColor="currentColor" offColor="hsl(var(--muted))" title={title} />
    </span>
  );
}

export function PageLoader({ label = "Loading data…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20" role="status">
      <Spinner size={28} title={label} />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

export function DataError({ message = "Unable to load data. Please try again." }: { message?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-destructive" role="alert">
      <AlertCircle className="size-4" />
      <span>{message}</span>
    </div>
  );
}
