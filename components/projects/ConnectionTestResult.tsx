"use client";

import * as React from "react";
import { CheckCircle2, ChevronDown, Lightbulb, RotateCcw, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { FAILURE_STAGE_LABEL } from "@/lib/adapters/diagnostics";
import { registry } from "@/lib/adapters/registry";
import type { TestResult } from "@/lib/adapters/types";
import { cn } from "@/lib/utils/cn";
import { formatDisplayDateTime } from "@/lib/utils/datetime";

interface Detail {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function engineName(result: TestResult) {
  return result.engine ? registry[result.engine].displayName : undefined;
}

function detailRows(result: TestResult): Detail[] {
  const f = result.failure;
  const rows: (Detail | false | undefined)[] = [
    !!result.engine && { label: "Engine", value: engineName(result) },
    !!result.target && { label: "Target", value: result.target, mono: true },
    !!f && { label: "Failed at", value: FAILURE_STAGE_LABEL[f.stage] },
    !!f && { label: "Error code", value: f.code, mono: true },
    !!f?.sqlState && { label: "SQLSTATE", value: f.sqlState, mono: true },
    !!f?.driverCode && { label: "Driver code", value: f.driverCode, mono: true },
    !!f?.httpStatus && { label: "HTTP", value: `${f.httpStatus} · POST ${f.endpoint ?? ""}`, mono: true },
    !f?.httpStatus && !!f?.endpoint && { label: "Endpoint", value: `POST ${f.endpoint}`, mono: true },
    !!f?.errorName && { label: "Error type", value: f.errorName, mono: true },
    !!result.serverVersion && { label: "Server", value: result.serverVersion },
    { label: "Latency", value: `${result.latencyMs} ms` },
    !!result.testedAt && { label: "Tested at", value: formatDisplayDateTime(result.testedAt) },
  ];
  return rows.filter(Boolean) as Detail[];
}

/** Plain-text report for the clipboard (already redacted by the adapters). */
export function formatTestReport(result: TestResult): string {
  const f = result.failure;
  const lines = [`HHP connection test: ${result.ok ? "OK" : "FAILED"}${f ? ` (${f.title})` : ""}`];
  for (const row of detailRows(result)) {
    lines.push(`${`${row.label}:`.padEnd(12)}${typeof row.value === "string" ? row.value : String(row.value)}`);
  }
  if (f) {
    lines.push("", "Error message:", f.message);
    if (f.hint) lines.push("", "What to do:", f.hint);
    if (f.responseBody) lines.push("", "Raw response:", f.responseBody);
  }
  return lines.join("\n");
}

function DetailsGrid({ rows }: { rows: Detail[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[max-content_1fr_max-content_1fr]">
      {rows.map((row) => (
        <React.Fragment key={row.label}>
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className={cn("min-w-0 break-words text-foreground", row.mono && "font-mono")}>{row.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * Shared, structured outcome of a "Test Connection" click. Shows the exact error
 * message, where it failed, what to do next, and the raw bridge response.
 */
export function ConnectionTestResult({
  result,
  onRetry,
  retrying = false,
  onDismiss,
  compact = false,
  className,
}: {
  result: TestResult;
  onRetry?: () => void;
  retrying?: boolean;
  onDismiss?: () => void;
  /** Collapses details behind a toggle (for project cards). */
  compact?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(!compact);
  const f = result.failure;

  if (result.ok) {
    return (
      <div
        role="status"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm animate-fade-in",
          className,
        )}
      >
        <span className="flex items-center gap-1.5 font-medium text-success">
          <CheckCircle2 className="size-4" /> Connected
        </span>
        <span className="text-xs text-muted-foreground">
          {[result.serverVersion, `${result.latencyMs} ms`, result.target].filter(Boolean).join(" · ")}
        </span>
        {onDismiss ? (
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onDismiss} aria-label="Dismiss">
            <X />
          </Button>
        ) : null}
      </div>
    );
  }

  const message = f?.message ?? result.message ?? "Connection failed";
  const title = f?.title ?? "Connection test failed";

  return (
    <div
      role="alert"
      className={cn(
        "overflow-hidden rounded-card border border-destructive/30 bg-card shadow-card animate-fade-in",
        className,
      )}
    >
      <div className="flex items-start gap-3 border-b border-destructive/15 bg-destructive/6 px-3.5 py-3">
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold leading-tight text-destructive">{title}</p>
          <div className="flex flex-wrap gap-1.5">
            {f ? (
              <Badge variant="destructive" className="font-mono">
                {f.code}
              </Badge>
            ) : null}
            {f ? <Badge variant="outline">{FAILURE_STAGE_LABEL[f.stage]}</Badge> : null}
            {f?.sqlState ? (
              <Badge variant="outline" className="font-mono">
                SQLSTATE {f.sqlState}
              </Badge>
            ) : f?.driverCode ? (
              <Badge variant="outline" className="font-mono">
                {f.driverCode}
              </Badge>
            ) : f?.httpStatus ? (
              <Badge variant="outline" className="font-mono">
                HTTP {f.httpStatus}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyButton value={formatTestReport(result)} label="Copy full report" />
          {onDismiss ? (
            <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
              <X />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 px-3.5 py-3">
        <section className="space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-table-head font-semibold uppercase tracking-wider text-muted-foreground">
              Exact error message
            </h3>
            <CopyButton value={message} label="Copy error message" />
          </div>
          <pre
            className={cn(
              "overflow-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground select-all",
              compact && !expanded && "line-clamp-3",
            )}
          >
            {message}
          </pre>
        </section>

        {expanded ? (
          <>
            {f?.hint ? (
              <section className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs">
                <Lightbulb className="mt-px size-3.5 shrink-0 text-warning" />
                <p>
                  <span className="font-semibold">What to do: </span>
                  {f.hint}
                </p>
              </section>
            ) : null}

            <section className="space-y-1.5">
              <h3 className="text-table-head font-semibold uppercase tracking-wider text-muted-foreground">Details</h3>
              <DetailsGrid rows={detailRows(result)} />
            </section>

            {f?.responseBody ? (
              <details className="group rounded-md border">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Raw response from the bridge
                  <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <pre className="max-h-48 overflow-auto border-t bg-muted/40 px-3 py-2 font-mono text-[0.6875rem] whitespace-pre-wrap break-all">
                  {f.responseBody}
                </pre>
              </details>
            ) : null}
          </>
        ) : null}

        {compact || onRetry ? (
          <div className="flex flex-wrap items-center gap-2">
            {compact ? (
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} rightIcon={<ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />}>
                {expanded ? "Hide details" : "Show details"}
              </Button>
            ) : null}
            {onRetry ? (
              <Button variant="outline" size="sm" loading={retrying} leftIcon={<RotateCcw />} onClick={onRetry} className="ml-auto">
                Test again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
