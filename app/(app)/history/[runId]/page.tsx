"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileJson } from "lucide-react";
import { ManifestViewer } from "@/components/history/ManifestViewer";
import { Button } from "@/components/ui/button";
import { Alert, InlineLoader, PageHeader } from "@/components/ui/misc";
import { loadSnapshotByRunId, type SnapshotSummary } from "@/lib/services/extraction.service";

export default function SnapshotDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [snapshot, setSnapshot] = React.useState<SnapshotSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    loadSnapshotByRunId(runId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [runId]);

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/history">
          <ArrowLeft /> Back to history
        </Link>
      </Button>
      <PageHeader
        icon={<FileJson />}
        eyebrow="Snapshot"
        title="Snapshot manifest"
        description="File list, SHA-256 checksums, and a read-only SQL preview."
      />
      {loading ? (
        <InlineLoader label="Loading snapshot manifest..." />
      ) : error || !snapshot ? (
        <Alert variant="destructive">{error ?? "Snapshot not found"}</Alert>
      ) : (
        <ManifestViewer snapshot={snapshot} />
      )}
    </div>
  );
}
