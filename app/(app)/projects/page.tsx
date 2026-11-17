"use client";

import * as React from "react";
import Link from "next/link";
import { Database, Plus, Search } from "lucide-react";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/misc";
import { loadProjects } from "@/lib/services/project.service";
import { useProjectStore } from "@/stores/project.store";

export default function ProjectsPage() {
  const { projects, loaded } = useProjectStore();
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!loaded) {
      loadProjects().catch(() => {});
    }
  }, [loaded]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.engine.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        (p.notes ?? "").toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Registered database connections stored in your encrypted local vault."
        actions={
          <Button asChild>
            <Link href="/projects/new">
              <Plus /> New project
            </Link>
          </Button>
        }
      />

      {projects.length > 0 ? (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, engine, or tag..."
            className="pl-9"
          />
        </div>
      ) : null}

      {!loaded ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner /> Decrypting project vault...
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Database />}
          title="No projects yet"
          description="Add a SQLite database file (or register a server connection) to start extracting schemas."
          action={
            <Button asChild>
              <Link href="/projects/new">
                <Plus /> Create your first project
              </Link>
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching projects" description={`Nothing matched "${query}".`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
