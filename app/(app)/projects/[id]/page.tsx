"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Edit3, Play, Plug, Trash2 } from "lucide-react";
import { Timeline } from "@/components/history/Timeline";
import { ConnectionTestResult } from "@/components/projects/ConnectionTestResult";
import { EngineBadge } from "@/components/projects/EngineBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDangerDialog } from "@/components/ui/confirm-danger-dialog";
import { Alert, PageHeader, Spinner } from "@/components/ui/misc";
import type { TestResult } from "@/lib/adapters/types";
import type { ConnectionConfig } from "@/lib/schemas";
import { listSnapshots, type SnapshotSummary } from "@/lib/services/extraction.service";
import {
  deleteProject,
  loadConnectionConfig,
  loadProjects,
  testProjectConnection,
} from "@/lib/services/project.service";
import { getSqliteFileName } from "@/lib/storage";
import { formatDisplayDateTime } from "@/lib/utils/datetime";
import { useProjectStore } from "@/stores/project.store";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id));
  const [conn, setConn] = React.useState<ConnectionConfig | null>(null);
  const [sqliteFileName, setSqliteFileName] = React.useState<string | null>(null);
  const [snapshots, setSnapshots] = React.useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!useProjectStore.getState().loaded) await loadProjects();
        const [c, runs, fn] = await Promise.all([
          loadConnectionConfig(id),
          listSnapshots(id),
          getSqliteFileName(id),
        ]);
        if (!active) return;
        setConn(c);
        setSnapshots(runs);
        setSqliteFileName(fn);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [id]);

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testProjectConnection(id));
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Loading project...
      </div>
    );
  }

  if (!project) {
    return <Alert variant="destructive">Project not found.</Alert>;
  }

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/projects">
            <ArrowLeft /> All projects
          </Link>
        </Button>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2.5">
              <span>{project.name}</span>
              <EngineBadge engine={project.engine} />
            </span>
          }
          description={project.notes || "Encrypted connection profile and extraction history."}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={testing}>
                {testing ? <Spinner /> : <Plug />}
                Test Connection
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/projects/${project.id}/edit`}>
                  <Edit3 /> Edit
                </Link>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="text-destructive" /> Delete
              </Button>
              <Button asChild size="sm">
                <Link href={`/projects/${project.id}/extract`}>
                  <Play /> Extract Now
                </Link>
              </Button>
            </>
          }
        />
      </div>

      {testResult ? (
        <ConnectionTestResult
          result={testResult}
          onRetry={onTest}
          retrying={testing}
          onDismiss={() => setTestResult(null)}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Connection summary</CardTitle>
          <CardDescription>
            Decrypted in memory from <code className="font-mono">vault/{project.id}/conn.enc</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <DetailItem label="Database" value={conn?.database ?? "—"} mono />
          {project.engine === "sqlite" ? (
            <DetailItem label="SQLite file" value={sqliteFileName ?? "Attached"} mono />
          ) : (
            <DetailItem
              label="Endpoint"
              value={`${conn?.host ?? "127.0.0.1"}${conn?.port ? `:${conn.port}` : ""}`}
              mono
            />
          )}
          <DetailItem label="Last extracted" value={formatDisplayDateTime(project.lastExtractedAt)} />
          <DetailItem label="Last connection test" value={formatDisplayDateTime(project.lastTestOkAt)} />
          {conn?.username ? <DetailItem label="Username" value={conn.username} mono /> : null}
          {conn?.schema ? <DetailItem label="Default schema" value={conn.schema} mono /> : null}
          {project.tags.length > 0 ? (
            <div className="sm:col-span-3">
              <p className="mb-1 text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1">
                {project.tags.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-section-title font-semibold tracking-tight">Extraction history ({snapshots.length})</h2>
        <Timeline snapshots={snapshots} showProjectName={false} />
      </section>

      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${project.name}"?`}
        description={
          <>
            This deletes the encrypted connection file <code className="font-mono">vault/{project.id}/conn.enc</code>.
            Previously exported SQL snapshots in <code className="font-mono">exports/</code> are kept.
          </>
        }
        confirmLabel="Delete project"
        onConfirm={async () => {
          await deleteProject(project.id);
          router.replace("/projects");
        }}
      />
    </div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
