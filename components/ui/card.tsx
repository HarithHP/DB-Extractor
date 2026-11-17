import * as React from "react";
import { cn } from "@/lib/utils/cn";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("rounded-card border bg-card text-card-foreground shadow-card animate-fade-in", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-1 p-card-sm sm:p-card", className)} {...props} />;
}

export function CardTitle({ className, ...props }: DivProps) {
  return <div className={cn("text-section-title font-semibold leading-tight tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: DivProps) {
  return <div className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("p-card-sm pt-0 sm:p-card sm:pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-b-card border-t bg-muted/30 px-card-sm py-3 sm:px-card",
        className,
      )}
      {...props}
    />
  );
}

/** Tinted square that holds a section/stat icon; sized by `--icon-tile-size`. */
export function IconTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex size-[var(--icon-tile-size)] shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10 ring-inset [&_svg]:size-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card with an icon + title header row and optional actions, used for page sections. */
export function SectionCard({
  icon,
  title,
  description,
  actions,
  children,
  footer,
  className,
  contentClassName,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-col gap-3 p-card-sm sm:flex-row sm:items-start sm:justify-between sm:p-card">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? <IconTile>{icon}</IconTile> : null}
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-section-title font-semibold leading-tight tracking-tight">{title}</h2>
            {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children ? <div className={cn("px-card-sm pb-card-sm sm:px-card sm:pb-card", contentClassName)}>{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap items-center gap-2 rounded-b-card border-t bg-muted/30 px-card-sm py-2.5 sm:px-card">{footer}</div>
      ) : null}
    </Card>
  );
}
