"use client";

import * as React from "react";
import { AlertTriangle, Boxes, Clock, Download, Eye, FileCode2, FileJson, Files, Server } from "lucide-react";
import { EngineBadge } from "@/components/projects/EngineBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, Spinner } from "@/components/ui/misc";
import { StatCard, StatGrid } from "@/components/ui/stat";
import { CATEGORY_MAP } from "@/lib/adapters/categories";
import type { Manifest, ObjectCategory } from "@/lib/schemas";
import { downloadSnapshotZip, readSnapshotFile, type SnapshotSummary } from "@/lib/services/extraction.service";
import { formatDisplayDateTime, formatDuration } from "@/lib/utils/datetime";

type FileEntry = Manifest["files"][number];
type CountRow = { category: string; count: number };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function categoryLabel(cat: string) {
  return CATEGORY_MAP[cat as ObjectCategory]?.label ?? cat;
}

export function ManifestViewer({ snapshot }: { snapshot: SnapshotSummary }) {
  const { manifest, dir, partial } = snapshot;
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [previewContent, setPreviewContent] = React.useState("");
  const [loadingFile, setLoadingFile] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);

  async function openPreview(path: string) {
    setPreviewPath(path);
    setLoadingFile(true);
    try {
      setPreviewContent(await readSnapshotFile(dir, path));
    } catch (err) {
      setPreviewContent(`-- Could not read file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingFile(false);
    }
  }

  async function onDownloadZip() {
    setDownloading(true);
    try {
      await downloadSnapshotZip(dir, manifest);
    } finally {
      setDownloading(false);
    }
  }

  const totalBytes = manifest.files.reduce((n, f) => n + f.bytes, 0);
  const totalObjects = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
  const countRows: CountRow[] = Object.entries(manifest.counts).map(([category, count]) => ({ category, count }));

  const countColumns: DataTableColumn<CountRow>[] = [
    {
      id: "category",
      header: "Category",
      mobile: "title",
      sortValue: (r) => categoryLabel(r.category),
      cell: (r) => <span className="font-medium">{categoryLabel(r.category)}</span>,
    },
    {
      id: "file",
      header: "Bulk file",
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {CATEGORY_MAP[r.category as ObjectCategory]?.bulkFilename ?? "—"}
        </span>
      ),
    },
    {
      id: "count",
      header: "Objects",
      align: "right",
      sortValue: (r) => r.count,
      cell: (r) => <span className="font-semibold tabular-nums">{r.count}</span>,
    },
  ];

  const fileColumns: DataTableColumn<FileEntry>[] = [
    {
      id: "path",
      header: "File",
      mobile: "title",
      sortValue: (f) => f.path,
      cell: (f) => (
        <span className="flex min-w-0 items-center gap-2">
          <FileCode2 className="size-4 shrink-0 text-primary" />
          <span className="truncate font-mono text-xs font-medium">{f.path}</span>
        </span>
      ),
    },
    {
      id: "category",
      header: "Category",
      sortValue: (f) => f.category,
      cell: (f) => <Badge variant="secondary">{categoryLabel(f.category)}</Badge>,
    },
    {
      id: "bytes",
      header: "Size",
      align: "right",
      sortValue: (f) => f.bytes,
      cell: (f) => <span className="tabular-nums whitespace-nowrap">{formatBytes(f.bytes)}</span>,
    },
    {
      id: "sha",
      header: "SHA-256",
      hideBelowLg: true,
      cell: (f) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <code className="font-mono text-xs text-muted-foreground" title={f.sha256}>
            {f.sha256.slice(0, 12)}…
          </code>
          <CopyButton value={f.sha256} label="Copy SHA-256" />
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      mobile: "actions",
      cell: (f) => (
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Eye />}
          onClick={(e) => {
            e.stopPropagation();
            openPreview(f.path);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionCard
        icon={<FileJson />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {manifest.projectName}
            <EngineBadge engine={manifest.engine} />
            <Badge variant="outline" className="font-mono">
              {manifest.database}
            </Badge>
          </span>
        }
        description={<span className="break-all font-mono text-xs">{dir}</span>}
        actions={
          <Button loading={downloading} leftIcon={<Download />} onClick={onDownloadZip}>
            Download ZIP
          </Button>
        }
      >
        {partial ? (
          <Alert variant="warning" icon={<AlertTriangle className="text-warning" />}>
            This snapshot is marked <code className="font-mono">_partial</code>: the extraction failed before finishing.
          </Alert>
        ) : null}
      </SectionCard>

      <StatGrid>
        <StatCard icon={<Clock />} label="Extracted" value={formatDisplayDateTime(manifest.extractedAt)} />
        <StatCard
          icon={<Files />}
          label="Files"
          value={manifest.files.length}
          hint={formatBytes(totalBytes)}
          tone="success"
        />
        <StatCard icon={<Boxes />} label="Objects" value={totalObjects} hint={formatDuration(manifest.durationMs)} tone="info" />
        <StatCard icon={<Server />} label="Server" value={manifest.serverVersion ?? "n/a"} tone="muted" />
      </StatGrid>

      {manifest.warnings.length > 0 ? (
        <Alert variant="warning" icon={<AlertTriangle className="text-warning" />}>
          <ul className="list-disc space-y-0.5 pl-4">
            {manifest.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-section-title font-semibold tracking-tight">Object counts</h2>
        <DataTable
          columns={countColumns}
          rows={countRows}
          rowKey={(r) => r.category}
          caption="Object counts by category"
          dense
          striped
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-section-title font-semibold tracking-tight">Exported files</h2>
        <DataTable
          columns={fileColumns}
          rows={manifest.files}
          rowKey={(f) => f.path}
          caption="Exported files"
          searchText={(f) => `${f.path} ${f.category}`}
          searchPlaceholder="Filter files..."
          pageSize={25}
          onRowClick={(f) => openPreview(f.path)}
        />
      </section>

      <details className="group rounded-card border bg-card shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-card-sm py-2.5 text-sm font-semibold sm:px-card">
          Raw manifest.json
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="relative border-t p-card-sm sm:p-card">
          <CopyButton value={JSON.stringify(manifest, null, 2)} label="Copy manifest" className="absolute top-6 right-6 sm:top-7 sm:right-7" />
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </div>
      </details>

      <Dialog open={previewPath !== null} onOpenChange={(o) => !o && setPreviewPath(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="break-all font-mono text-sm">{previewPath}</DialogTitle>
            <DialogDescription>Read-only preview from local snapshot storage.</DialogDescription>
          </DialogHeader>
          {loadingFile ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner /> Reading file...
            </div>
          ) : (
            <div className="relative">
              <CopyButton value={previewContent} label="Copy SQL" className="absolute top-2 right-2" />
              <pre className="max-h-[60dvh] overflow-auto rounded-lg bg-muted p-3 pr-12 font-mono text-xs">
                {previewContent}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
