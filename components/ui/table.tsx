import * as React from "react";
import { cn } from "@/lib/utils/cn";

export function TableContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative w-full overflow-x-auto rounded-card border bg-card shadow-card", className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full caption-bottom border-collapse text-table", className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-table-header", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child]:border-b-0", className)} {...props} />;
}

export function TableRow({
  className,
  striped,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { striped?: boolean; interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-table-border transition-colors",
        striped && "even:bg-table-stripe",
        interactive && "cursor-pointer hover:bg-table-row-hover",
        !interactive && "hover:bg-table-row-hover/60",
        className,
      )}
      {...props}
    />
  );
}

export type CellAlign = "left" | "center" | "right";

const alignClass: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function TableHead({
  className,
  align = "left",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: CellAlign }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-[var(--table-head-height)] border-b border-table-border px-[var(--table-cell-px)] text-table-head font-semibold uppercase tracking-wider whitespace-nowrap text-muted-foreground",
        alignClass[align],
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  align = "left",
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: CellAlign }) {
  return (
    <td
      className={cn("px-[var(--table-cell-px)] py-[var(--table-cell-py)] align-middle", alignClass[align], className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("py-3 text-xs text-muted-foreground", className)} {...props} />;
}
