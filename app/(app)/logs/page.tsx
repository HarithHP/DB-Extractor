"use client";

import * as React from "react";
import { AlertOctagon, AlertTriangle, Download, Info, ScrollText, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { SegmentedControl } from "@/components/ui/segmented";
import { StatCard, StatGrid } from "@/components/ui/stat";
import { useLogStore, type LogEntry, type LogLevel } from "@/stores/log.store";

const LEVEL_BADGE: Record<LogLevel, BadgeVariant> = {
  info: "info",
  warn: "warning",
  error: "destructive",
};

const columns: DataTableColumn<LogEntry>[] = [
  {
    id: "time",
    header: "Time",
    sortValue: (e) => e.timestamp,
    cell: (e) => (
      <time dateTime={e.timestamp} className="font-mono text-xs whitespace-nowrap text-muted-foreground">
        {e.timestamp.slice(11, 19)}
      </time>
    ),
  },
  {
    id: "level",
    header: "Level",
    sortValue: (e) => e.level,
    cell: (e) => (
      <Badge variant={LEVEL_BADGE[e.level]} className="uppercase" dot>
        {e.level}
      </Badge>
    ),
  },
  {
    id: "scope",
    header: "Scope",
    sortValue: (e) => e.scope,
    cell: (e) => <code className="font-mono text-xs text-muted-foreground">{e.scope}</code>,
  },
  {
    id: "message",
    header: "Message",
    mobile: "title",
    cell: (e) => (
      <div className="min-w-0 break-words">
        <p>{e.message}</p>
        {e.details ? <p className="mt-0.5 font-mono text-xs text-muted-foreground">{e.details}</p> : null}
      </div>
    ),
  },
];

export default function LogsPage() {
  const { entries, clear } = useLogStore();
  const [filter, setFilter] = React.useState<"all" | LogLevel>("all");

  const counts = React.useMemo(
    () => ({
      info: entries.filter((e) => e.level === "info").length,
      warn: entries.filter((e) => e.level === "warn").length,
      error: entries.filter((e) => e.level === "error").length,
    }),
    [entries],
  );

  const visible = React.useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.level === filter)),
    [entries, filter],
  );

  function onDownload() {
    const text = entries
      .map((e) => `${e.timestamp} [${e.level.toUpperCase()}] (${e.scope}) ${e.message}${e.details ? ` | ${e.details}` : ""}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hhp-session-${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<ScrollText />}
        eyebrow="Diagnostics"
        title="Session logs"
        description="In-memory log stream for this session. Secrets are redacted before anything is recorded."
        actions={
          <>
            <Button variant="outline" size="sm" leftIcon={<Download />} onClick={onDownload} disabled={entries.length === 0}>
              Download .log
            </Button>
            <Button variant="destructive-soft" size="sm" leftIcon={<Trash2 />} onClick={clear} disabled={entries.length === 0}>
              Clear
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatCard icon={<ScrollText />} label="Entries" value={entries.length} tone="primary" />
        <StatCard icon={<Info />} label="Info" value={counts.info} tone="info" />
        <StatCard icon={<AlertTriangle />} label="Warnings" value={counts.warn} tone="warning" />
        <StatCard icon={<AlertOctagon />} label="Errors" value={counts.error} tone="destructive" />
      </StatGrid>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(e) => e.id}
        caption="Session log entries"
        initialSort={{ id: "time", direction: "desc" }}
        searchText={(e) => `${e.scope} ${e.message} ${e.details ?? ""}`}
        searchPlaceholder="Search logs..."
        pageSize={50}
        toolbar={
          <SegmentedControl<"all" | LogLevel>
            ariaLabel="Filter by level"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", suffix: entries.length },
              { value: "info", label: "Info", suffix: counts.info },
              { value: "warn", label: "Warn", suffix: counts.warn },
              { value: "error", label: "Error", suffix: counts.error },
            ]}
          />
        }
        empty={
          <EmptyState
            icon={<ShieldCheck />}
            title={entries.length === 0 ? "No log entries yet" : "No entries at this level"}
            description="Auth, connection-test, and extraction events show up here, with passwords and tokens redacted."
          />
        }
      />
    </div>
  );
}
