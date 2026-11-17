"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional count/suffix shown after the label. */
  suffix?: React.ReactNode;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "md",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-[var(--btn-radius)] border bg-muted/60 p-0.5", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[calc(var(--btn-radius)-2px)] font-medium whitespace-nowrap transition-all [&_svg]:size-3.5",
              size === "sm"
                ? "h-[calc(var(--btn-height-sm)-6px)] px-2.5 text-btn-sm"
                : "h-[calc(var(--btn-height-md)-6px)] px-3 text-btn-md",
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.icon}
            {opt.label}
            {opt.suffix !== undefined ? (
              <span className="rounded-full bg-muted px-1.5 text-[0.6875rem] tabular-nums text-muted-foreground">
                {opt.suffix}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
