import * as React from "react";
import { Database, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />;
}

export function Alert({
  variant = "default",
  className,
  icon,
  children,
}: {
  variant?: "default" | "destructive" | "warning" | "success" | "info";
  className?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "default" && "bg-muted/60",
        variant === "destructive" && "border-destructive/30 bg-destructive/8 text-destructive",
        variant === "warning" && "border-warning/40 bg-warning/10",
        variant === "success" && "border-success/30 bg-success/10 text-success",
        variant === "info" && "border-info/30 bg-info/10",
        className,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between animate-fade-in">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-primary-foreground shadow-raised ring-1 ring-white/15 ring-inset sm:flex [&_svg]:size-[1.125rem]">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-0.5 text-table-head font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
          ) : null}
          <h1 className="truncate text-page-title font-semibold leading-tight tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed bg-card/50 px-6 py-10 text-center animate-fade-in">
      {icon ? (
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/10 ring-inset [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function InlineLoader({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner /> {label}
    </div>
  );
}

export function FullScreenLoader({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 animate-fade-in">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-2xl bg-primary/20" aria-hidden />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-[image:var(--gradient-brand)] text-primary-foreground shadow-raised">
          <Database className="size-8" />
        </div>
      </div>
      <div className="text-center">
        <p className="font-semibold tracking-tight">HHP Database Extractor</p>
        <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {label}
        </p>
      </div>
    </div>
  );
}
