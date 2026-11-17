"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileCode2, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/misc";
import { downloadSnapshotZip, type ExtractionRunOutput } from "@/lib/services/extraction.service";
import { formatDuration } from "@/lib/utils/datetime";

export function ResultCard({
  output,
  rootName,
  onRunAgain,
}: {
  output: ExtractionRunOutput;
  rootName: string;
  onRunAgain: () => void;
}) {
  const [downloading, setDownloading] = React.useState(false);
  const { manifest, dir, runId } = output;

  async function onDownloadZip() {
    setDownloading(true);
    try {
      await downloadSnapshotZip(dir, manifest);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">Extraction complete</span>
        </div>
        <CardTitle>
          Wrote {manifest.files.length} files in {formatDuration(manifest.durationMs)}
        </CardTitle>
        <CardDescription>
          Snapshot written inside <strong className="font-mono">{rootName}</strong>:
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs break-all">
          <FolderOpen className="size-4 shrink-0 text-primary" />
          <span>{dir}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">mode: {manifest.options.mode ?? "schema"}</Badge>
          {Object.entries(manifest.counts).map(([cat, count]) => (
            <Badge key={cat} variant="secondary">
              {cat}: {count}
            </Badge>
          ))}
        </div>

        {manifest.warnings.length > 0 ? (
          <ul className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {manifest.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>

      <CardFooter>
        <Button type="button" onClick={onDownloadZip} disabled={downloading}>
          {downloading ? <Spinner /> : <Download />}
          Download snapshot ZIP
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/history/${runId}`}>
            <FileCode2 /> Open manifest &amp; SQL preview
          </Link>
        </Button>
        <Button type="button" variant="ghost" className="ml-auto" onClick={onRunAgain}>
          Run another extraction
        </Button>
      </CardFooter>
    </Card>
  );
}
