"use client";

import type { ProgressEvent } from "@/lib/adapters/types";

export function formatProgressEvent(evt: ProgressEvent): string {
  switch (evt.kind) {
    case "phase":
      return `[phase] ${evt.phase.toUpperCase()}`;
    case "category":
      return `[category] ${evt.category}: ${evt.done}${evt.total !== undefined ? `/${evt.total}` : ""}`;
    case "object":
      return `[wrote] (${evt.category}) ${evt.name}`;
    case "warn":
      return `[warn] ${evt.message}`;
    case "error":
      return `[error] ${evt.message}`;
  }
}

export function ProgressLog({ events }: { events: ProgressEvent[] }) {
  return (
    <div
      role="log"
      aria-live="polite"
      className="max-h-72 overflow-y-auto rounded-lg border bg-muted/60 p-3 font-mono text-xs leading-relaxed"
    >
      {events.length === 0 ? (
        <p className="text-muted-foreground">Waiting for extraction events...</p>
      ) : (
        events.map((evt, idx) => (
          <div
            key={idx}
            className={
              evt.kind === "error"
                ? "text-destructive"
                : evt.kind === "warn"
                  ? "text-warning"
                  : evt.kind === "phase"
                    ? "font-semibold text-primary"
                    : "text-foreground"
            }
          >
            {formatProgressEvent(evt)}
          </div>
        ))
      )}
    </div>
  );
}
