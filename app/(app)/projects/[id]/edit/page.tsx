"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { Alert, PageHeader, Spinner } from "@/components/ui/misc";
import type { ConnectionConfig, Project } from "@/lib/schemas";
import { loadConnectionConfig, loadProjects } from "@/lib/services/project.service";
import { useProjectStore } from "@/stores/project.store";

export default function EditProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = React.useState<Project | null>(null);
  const [conn, setConn] = React.useState<ConnectionConfig | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    async function load() {
      try {
        const list = useProjectStore.getState().loaded ? useProjectStore.getState().projects : await loadProjects();
        const found = list.find((p) => p.id === id) ?? null;
        const cfg = found ? await loadConnectionConfig(found.id) : null;
        if (!active) return;
        setProject(found);
        setConn(cfg);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Loading project...
      </div>
    );
  }
  if (!project || !conn) return <Alert variant="destructive">Project not found.</Alert>;

  return (
    <div className="space-y-5">
      <PageHeader title={`Edit ${project.name}`} description="Update project metadata or rotate stored credentials." />
      <ProjectForm existing={project} existingConnection={conn} />
    </div>
  );
}
