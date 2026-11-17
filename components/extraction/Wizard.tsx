"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { OptionsForm } from "./OptionsForm";
import { ProgressLog } from "./ProgressLog";
import { ResultCard } from "./ResultCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Spinner } from "@/components/ui/misc";
import type { ProgressEvent } from "@/lib/adapters/types";
import { DEFAULT_EXTRACTION_OPTIONS, type ExtractionOptions, type Project } from "@/lib/schemas";
import { runExtraction, type ExtractionRunOutput } from "@/lib/services/extraction.service";
import { loadSettings } from "@/lib/services/settings.service";
import { storage } from "@/lib/storage";

type WizardStep = "options" | "running" | "done";

export function ExtractionWizard({ project }: { project: Project }) {
  const [step, setStep] = React.useState<WizardStep>("options");
  const [options, setOptions] = React.useState<ExtractionOptions>(DEFAULT_EXTRACTION_OPTIONS);
  const [events, setEvents] = React.useState<ProgressEvent[]>([]);
  const [output, setOutput] = React.useState<ExtractionRunOutput | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rootName, setRootName] = React.useState("");

  React.useEffect(() => {
    loadSettings()
      .then((s) => setOptions(s.defaultOptions))
      .catch(() => {});
    storage.getRootName().then(setRootName).catch(() => {});
  }, []);

  async function onStart() {
    setError(null);
    setEvents([]);
    setOutput(null);
    setStep("running");
    try {
      const result = await runExtraction(project.id, options, (evt) => {
        setEvents((prev) => [...prev, evt]);
      });
      setOutput(result);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 text-xs font-medium">
        {(
          [
            ["options", "1. Options"],
            ["running", "2. Extract & write"],
            ["done", "3. Result"],
          ] as const
        ).map(([id, label]) => (
          <div
            key={id}
            className={`rounded-lg border px-3 py-2 text-center ${
              step === id ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {step === "options" ? (
        <Card>
          <CardHeader>
            <CardTitle>Extraction options</CardTitle>
            <CardDescription>
              Choose backup mode (schema only, full SQL, or native), then which schema objects to include.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OptionsForm value={options} onChange={setOptions} />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="button" onClick={onStart}>
              <Play />{" "}
              {options.mode === "schema"
                ? "Run extraction"
                : options.mode === "native"
                  ? "Run native backup"
                  : "Run full backup"}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === "running" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {!error ? <Spinner /> : null}
              {error ? "Extraction failed" : `Extracting ${project.name}...`}
            </CardTitle>
            <CardDescription>
              Streaming progress events from the adapter and filesystem writer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressLog events={events} />
            {error ? (
              <Alert variant="destructive">
                {error} (any partial output folder was marked with <code className="font-mono">_partial</code>).
              </Alert>
            ) : null}
          </CardContent>
          {error ? (
            <CardFooter className="justify-end">
              <Button type="button" variant="outline" onClick={() => setStep("options")}>
                Back to options
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      ) : null}

      {step === "done" && output ? (
        <div className="space-y-4">
          <ResultCard output={output} rootName={rootName} onRunAgain={() => setStep("options")} />
          <Card>
            <CardHeader>
              <CardTitle>Extraction log</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressLog events={events} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
