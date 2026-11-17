"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ExtractionWizard } from "@/components/extraction/Wizard";
import { EngineBadge } from "@/components/projects/EngineBadge";
import { Button } from "@/components/ui/button";
import { Alert, PageHeader, Spinner } from "@/components/ui/misc";
import { loadProjects } from "@/lib/services/project.service";
import { useProjectStore } from "@/stores/project.store";

export default function ExtractProjectPage() {
  const { id } = useParams<{ id: string }>();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id));
  const loaded = useProjectStore((s) => s.loaded);

  React.useEffect(() => {
    if (!loaded) loadProjects().catch(() => {});
  }, [loaded]);

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Loading project...
      </div>
    );
  }
  if (!project) return <Alert variant="destructive">Project not found.</Alert>;

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={`/projects/${project.id}`}>
            <ArrowLeft /> Back to {project.name}
          </Link>
        </Button>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2.5">
              <span>Extract {project.name}</span>
              <EngineBadge engine={project.engine} />
            </span>
          }
          description="Generates a new immutable snapshot folder under exports/."
        />
      </div>
      <ExtractionWizard project={project} />
    </div>
  );
}
