import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description &&
          (typeof description === "string" ? (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          ) : (
            <div className="text-sm text-muted-foreground mt-1">{description}</div>
          ))}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
