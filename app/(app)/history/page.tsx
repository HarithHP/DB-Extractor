"use client";

import * as React from "react";
import { Clock, Database, FileStack, History, RefreshCw } from "lucide-react";
import { Timeline } from "@/components/history/Timeline";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { InlineLoader, PageHeader } from "@/components/ui/misc";
import { StatCard, StatGrid } from "@/components/ui/stat";
import { listSnapshots, type SnapshotSummary } from "@/lib/services/extraction.service";
import { formatDisplayDateTime } from "@/lib/utils/datetime";

export default function HistoryPage() {
  const [snapshots, setSnapshots] = React.useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [projectFilter, setProjectFilter] = React.useState("all");

  const load = React.useCallback(() => {
    return listSnapshots()
      .then(setSnapshots)
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    setLoading(true);
    load();
  }

  const projects = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of snapshots) map.set(s.manifest.projectId, s.manifest.projectName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [snapshots]);

  const visible = projectFilter === "all" ? snapshots : snapshots.filter((s) => s.manifest.projectId === projectFilter);
  const totalFiles = visible.reduce((n, s) => n + s.manifest.files.length, 0);
  const latest = visible[0]?.manifest.extractedAt;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<History />}
        eyebrow="Snapshots"
        title="Extraction history"
        description="Every timestamped snapshot under exports/, newest first. Click a row to open its manifest."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
            leftIcon={<RefreshCw className={loading ? "animate-spin" : ""} />}
          >
            Refresh
          </Button>
        }
      />

      <StatGrid>
        <StatCard icon={<History />} label="Snapshots" value={visible.length} />
        <StatCard icon={<Database />} label="Projects" value={projectFilter === "all" ? projects.length : 1} tone="info" />
        <StatCard icon={<FileStack />} label="Files written" value={totalFiles.toLocaleString()} tone="success" />
        <StatCard
          icon={<Clock />}
          label="Latest run"
          value={latest ? formatDisplayDateTime(latest).split(",")[0] : "—"}
          hint={latest ? formatDisplayDateTime(latest) : "No runs yet"}
          tone="muted"
        />
      </StatGrid>

      {loading ? (
        <InlineLoader label="Scanning exports/..." />
      ) : (
        <Timeline
          snapshots={visible}
          toolbar={
            projects.length > 1 ? (
              <NativeSelect
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full sm:w-52"
                aria-label="Filter by project"
              >
                <option value="all">All projects</option>
                {projects.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
