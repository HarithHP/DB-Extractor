import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { IconTile } from "./card";

type Tone = "primary" | "success" | "warning" | "destructive" | "info" | "muted";

const toneClass: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/12 text-destructive",
  info: "bg-info/12 text-info",
  muted: "bg-muted text-muted-foreground",
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-card border bg-card p-3.5 shadow-card transition-[border-color,box-shadow] duration-200 animate-fade-in hover:border-primary/25",
        className,
      )}
    >
      {icon ? <IconTile className={cn("ring-0", toneClass[tone])}>{icon}</IconTile> : null}
      <div className="min-w-0">
        <p className="text-table-head font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-stat font-semibold tabular-nums tracking-tight">{value}</p>
        {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}
