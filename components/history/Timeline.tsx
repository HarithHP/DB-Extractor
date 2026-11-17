"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileCode2, History } from "lucide-react";
import { EngineBadge } from "@/components/projects/EngineBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/misc";
import { downloadSnapshotZip, type SnapshotSummary } from "@/lib/services/extraction.service";
import { formatDisplayDateTime, formatDuration } from "@/lib/utils/datetime";

function totalObjects(s: SnapshotSummary) {
  return Object.values(s.manifest.counts).reduce((a, b) => a + b, 0);
}

export function Timeline({
  snapshots,
  showProjectName = true,
  searchable = true,
  toolbar,
}: {
  snapshots: SnapshotSummary[];
  showProjectName?: boolean;
  searchable?: boolean;
  toolbar?: React.ReactNode;
}) {
  const router = useRouter();
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  async function onDownload(s: SnapshotSummary) {
    setDownloadingId(s.runId);
    try {
      await downloadSnapshotZip(s.dir, s.manifest);
    } finally {
      setDownloadingId(null);
    }
  }

  const columns: DataTableColumn<SnapshotSummary>[] = [
    {
      id: "snapshot",
      header: showProjectName ? "Project / database" : "Database",
      mobile: "title",
      sortValue: (s) => `${s.manifest.projectName} ${s.manifest.database}`,
      cell: (s) => (
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {showProjectName ? (
              <Link
                href={`/projects/${s.manifest.projectId}`}
                onClick={(e) => e.stopPropagation()}
                className="font-semibold hover:text-primary"
              >
                {s.manifest.projectName}
              </Link>
            ) : null}
            <EngineBadge engine={s.manifest.engine} />
            <Badge variant="outline" className="font-mono">
              {s.manifest.database}
            </Badge>
          </div>
          <p className="max-w-[28rem] truncate font-mono text-xs text-muted-foreground" title={s.dir}>
            {s.dir.split("/").slice(-1)[0]}
          </p>
        </div>
      ),
    },
    {
      id: "extractedAt",
      header: "Extracted",
      sortValue: (s) => s.manifest.extractedAt,
      cell: (s) => <span className="whitespace-nowrap">{formatDisplayDateTime(s.manifest.extractedAt)}</span>,
    },
    {
      id: "files",
      header: "Files",
      align: "right",
      sortValue: (s) => s.manifest.files.length,
      cell: (s) => (
        <span className="whitespace-nowrap tabular-nums">
          {s.manifest.files.length}
          <span className="ml-1 hidden text-xs text-muted-foreground lg:inline">({totalObjects(s)} obj)</span>
        </span>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      align: "right",
      hideBelowLg: true,
      sortValue: (s) => s.manifest.durationMs,
      cell: (s) => <span className="tabular-nums">{formatDuration(s.manifest.durationMs)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (s) =>
        s.partial ? (
          <Badge variant="warning">
            <AlertTriangle /> Partial
          </Badge>
        ) : (
          <Badge variant="success">
            <CheckCircle2 /> Complete
          </Badge>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      mobile: "actions",
      cell: (s) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            loading={downloadingId === s.runId}
            leftIcon={<Download />}
            onClick={() => onDownload(s)}
          >
            ZIP
          </Button>
          <Button asChild variant="soft" size="sm">
            <Link href={`/history/${s.runId}`} aria-label="Open manifest" title="Open manifest">
              <FileCode2 />
              <span className="md:hidden lg:inline">Manifest</span>
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={snapshots}
      rowKey={(s) => s.runId}
      caption="Extraction snapshots"
      initialSort={{ id: "extractedAt", direction: "desc" }}
      searchText={searchable ? (s) => `${s.manifest.projectName} ${s.manifest.database} ${s.manifest.engine} ${s.dir}` : undefined}
      searchPlaceholder="Search snapshots..."
      toolbar={toolbar}
      pageSize={10}
      onRowClick={(s) => router.push(`/history/${s.runId}`)}
      empty={
        <EmptyState
          icon={<History />}
          title="No snapshots yet"
          description="Run an extraction on any project to create a timestamped, immutable snapshot folder."
        />
      }
    />
  );
}
