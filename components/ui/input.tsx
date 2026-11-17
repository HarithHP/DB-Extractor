import * as React from "react";
import { cn } from "@/lib/utils/cn";

// Below `md` fields stay at 16px so iOS Safari doesn't zoom the page on focus.
const fieldBase =
  "w-full rounded-md border border-input bg-card px-[var(--field-px)] text-[16px] shadow-xs transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/80 hover:border-primary/35 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-field";

export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cn(fieldBase, "flex h-[var(--input-height)] py-1", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "flex min-h-18 py-2 leading-relaxed", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "flex h-[var(--input-height)] py-1 pr-8", className)} {...props} />;
}
