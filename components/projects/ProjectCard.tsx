"use client";

import * as React from "react";
import Link from "next/link";
import { Play, Plug, Settings2 } from "lucide-react";
import { ConnectionTestResult } from "./ConnectionTestResult";
import { EngineBadge } from "./EngineBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/misc";
import type { TestResult } from "@/lib/adapters/types";
import type { Project } from "@/lib/schemas";
import { testProjectConnection } from "@/lib/services/project.service";
import { formatDisplayDateTime } from "@/lib/utils/datetime";

export function ProjectCard({ project }: { project: Project }) {
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<TestResult | null>(null);

  async function onTest() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testProjectConnection(project.id));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="truncate">
            <Link href={`/projects/${project.id}`} className="hover:underline">
              {project.name}
            </Link>
          </CardTitle>
          <EngineBadge engine={project.engine} />
        </div>
        {project.notes ? <p className="line-clamp-2 text-xs text-muted-foreground">{project.notes}</p> : null}
      </CardHeader>

      <CardContent className="space-y-2 pb-3 text-xs">
        {project.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {project.tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="text-muted-foreground">
          Last extraction: <strong className="text-foreground">{formatDisplayDateTime(project.lastExtractedAt)}</strong>
        </div>

        {result ? (
          <ConnectionTestResult result={result} compact onRetry={onTest} retrying={testing} onDismiss={() => setResult(null)} />
        ) : null}
      </CardContent>

      <CardFooter className="py-2.5">
        <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={testing}>
          {testing ? <Spinner /> : <Plug />}
          Test Connection
        </Button>
        <Button asChild size="sm">
          <Link href={`/projects/${project.id}/extract`}>
            <Play /> Extract Now
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon" className="ml-auto" title="Project details">
          <Link href={`/projects/${project.id}`} aria-label={`Open ${project.name}`}>
            <Settings2 />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
