"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, FileUp, Plug, Sparkles } from "lucide-react";
import { ADAPTER_LIST, registry } from "@/lib/adapters/registry";
import { describeBridgeError, failureFromError, makeFailure } from "@/lib/adapters/diagnostics";
import { getSqlJs } from "@/lib/adapters/sqlite";
import { ConnectionTestResult } from "./ConnectionTestResult";
import type { TestResult } from "@/lib/adapters/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert, Spinner } from "@/components/ui/misc";
import { ProjectNameSchema, type ConnectionConfig, type EngineId, type Project, type SslMode } from "@/lib/schemas";
import { createProject, runConnectionTest, updateProject } from "@/lib/services/project.service";
import { getSqliteFileName, pickSqliteFile, type PickedSqliteFile } from "@/lib/storage";

async function buildBundledSampleSqlite(): Promise<PickedSqliteFile> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      placed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE VIEW v_customer_totals AS
      SELECT c.id AS customer_id, c.email, COUNT(o.id) AS orders_count, COALESCE(SUM(o.total_cents), 0) AS total_cents
        FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
       GROUP BY c.id, c.email;
    CREATE TRIGGER trg_orders_nonnegative
    BEFORE INSERT ON orders
    BEGIN
      SELECT CASE WHEN NEW.total_cents < 0 THEN RAISE(ABORT, 'total_cents cannot be negative') END;
    END;
  `);
  const bytes = new Uint8Array(db.export());
  db.close();
  return { name: "sample_store.sqlite", bytes };
}

export function ProjectForm({
  existing,
  existingConnection,
}: {
  existing?: Project;
  existingConnection?: ConnectionConfig;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(existing?.name ?? "");
  const [engine, setEngine] = React.useState<EngineId>(existing?.engine ?? "sqlite");
  const [tags, setTags] = React.useState(existing?.tags.join(", ") ?? "");
  const [notes, setNotes] = React.useState(existing?.notes ?? "");

  const [host, setHost] = React.useState(existingConnection?.host ?? "127.0.0.1");
  const [port, setPort] = React.useState<string>(
    existingConnection?.port ? String(existingConnection.port) : "",
  );
  const [database, setDatabase] = React.useState(existingConnection?.database ?? "");
  const [schema, setSchema] = React.useState(existingConnection?.schema ?? "");
  const [username, setUsername] = React.useState(existingConnection?.username ?? "");
  const [password, setPassword] = React.useState(existingConnection?.password ?? "");
  const [showPassword, setShowPassword] = React.useState(false);
  const [ssl, setSsl] = React.useState<SslMode>(existingConnection?.ssl ?? "disable");
  const [sshHint, setSshHint] = React.useState(existingConnection?.sshHint ?? "");

  // Adapter-specific extra fields (PROJECT.md §4.3).
  const [authSource, setAuthSource] = React.useState(
    String(existingConnection?.extra?.authSource ?? "admin"),
  );
  const [redisDbIndex, setRedisDbIndex] = React.useState(
    String(existingConnection?.extra?.dbIndex ?? "0"),
  );
  const [datacenter, setDatacenter] = React.useState(
    String(existingConnection?.extra?.datacenter ?? "datacenter1"),
  );

  const [sqlitePicked, setSqlitePicked] = React.useState<PickedSqliteFile | null>(null);
  const [existingSqliteName, setExistingSqliteName] = React.useState<string | null>(null);

  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (existing?.engine === "sqlite") {
      getSqliteFileName(existing.id).then(setExistingSqliteName).catch(() => {});
    }
  }, [existing]);

  function onEngineChange(next: EngineId) {
    setEngine(next);
    setTestResult(null);
    const defPort = registry[next].defaultPort;
    setPort(defPort ? String(defPort) : "");
  }

  async function onPickSqlite() {
    setError(null);
    try {
      const picked = await pickSqliteFile();
      setSqlitePicked(picked);
      if (!database) setDatabase(picked.name.replace(/\.(db|sqlite3?)$/i, ""));
      if (!name) setName(picked.name.replace(/\.(db|sqlite3?)$/i, ""));
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function onLoadSampleSqlite() {
    setError(null);
    try {
      const picked = await buildBundledSampleSqlite();
      setSqlitePicked(picked);
      if (!database) setDatabase("sample_store");
      if (!name) setName("Sample Store");
    } catch (err) {
      setError(`Could not load the SQLite engine: ${describeBridgeError(err)}`);
    }
  }

  function buildExtra(): Record<string, unknown> | undefined {
    if (engine === "mongodb") return { authSource: authSource.trim() || "admin" };
    if (engine === "redis") return { dbIndex: Number(redisDbIndex) || 0 };
    if (engine === "cassandra") return { datacenter: datacenter.trim() || "datacenter1" };
    return undefined;
  }

  async function onTestDraft() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    const label = name.trim() || "Draft project";
    try {
      const adapter = registry[engine];
      if (engine === "sqlite") {
        const bytes = sqlitePicked?.bytes
          ? sqlitePicked.bytes
          : sqlitePicked?.handle
            ? new Uint8Array(await (await sqlitePicked.handle.getFile()).arrayBuffer())
            : undefined;
        if (!bytes && !existing) {
          const failure = makeFailure({
            code: "INPUT_MISSING",
            stage: "input",
            title: "No SQLite file selected",
            message: "Pick a SQLite .db file (or click 'Use sample DB') before testing.",
          });
          setTestResult({ ok: false, latencyMs: 0, message: failure.message, failure, engine, testedAt: new Date().toISOString() });
          return;
        }
        setTestResult(
          await runConnectionTest(
            "sqlite",
            {
              projectId: existing?.id ?? "draft",
              engine: "sqlite",
              database: database || sqlitePicked?.name || "sqlite",
              sqliteBytes: bytes,
            },
            label,
          ),
        );
      } else {
        setTestResult(
          await runConnectionTest(
            engine,
            {
              projectId: existing?.id ?? "draft",
              engine,
              host: host.trim() || "127.0.0.1",
              port: port ? Number(port) : adapter.defaultPort,
              database: database || "default",
              schema: schema || undefined,
              username: username || undefined,
              password: password || undefined,
              ssl,
              extra: buildExtra(),
            },
            label,
          ),
        );
      }
    } catch (err) {
      const failure = failureFromError(err, {
        code: "SQLITE_FILE_READ_FAILED",
        stage: "input",
        title: "Could not read the selected file",
      });
      setTestResult({ ok: false, latencyMs: 0, message: failure.message, failure, engine, testedAt: new Date().toISOString() });
    } finally {
      setTesting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedName = ProjectNameSchema.safeParse(name);
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "Invalid project name");
      return;
    }
    if (engine === "sqlite" && !sqlitePicked && !existingSqliteName) {
      setError("Pick a SQLite .db file (or click 'Use sample DB') before saving.");
      return;
    }
    const dbName = (database || sqlitePicked?.name || existingSqliteName || "").trim();
    if (!dbName) {
      setError("Database name is required.");
      return;
    }

    setBusy(true);
    try {
      const adapter = registry[engine];
      const input = {
        name: parsedName.data,
        engine,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes,
        sqliteFile: sqlitePicked ?? undefined,
        connection: {
          host: adapter.requiresNetwork ? host.trim() || "127.0.0.1" : undefined,
          port: adapter.requiresNetwork && port ? Number(port) : adapter.defaultPort,
          database: dbName,
          schema: schema.trim() || undefined,
          username: username.trim() || undefined,
          password: password || undefined,
          ssl: adapter.requiresNetwork ? ssl : undefined,
          sshHint: sshHint.trim() || undefined,
          extra: buildExtra(),
        },
      };

      const saved = existing ? await updateProject(existing.id, input) : await createProject(input);
      router.push(`/projects/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const adapter = registry[engine];

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Project metadata</CardTitle>
          <CardDescription>
            Project names are used as folder names under <code className="font-mono">exports/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Project name"
            htmlFor="proj-name"
            hint="Allowed: letters, numbers, spaces, dots, hyphens, underscores."
          >
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Billing Prod"
              required
            />
          </Field>

          <Field label="Database engine" htmlFor="proj-engine">
            <NativeSelect
              id="proj-engine"
              value={engine}
              onChange={(e) => onEngineChange(e.target.value as EngineId)}
            >
              {ADAPTER_LIST.map((a) => (
                <option key={a.engine} value={a.engine}>
                  {a.displayName}{" "}
                  {!a.supportedInCurrentMilestone ? "(coming soon)" : a.requiresNetwork ? "(via local bridge)" : "(in-browser)"}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Tags (comma-separated)" htmlFor="proj-tags">
            <Input
              id="proj-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="prod, billing"
            />
          </Field>

          <Field label="Notes (optional)" htmlFor="proj-notes" className="sm:col-span-2">
            <Textarea
              id="proj-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Read-only reporting replica..."
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{adapter.displayName} connection</CardTitle>
          <CardDescription>
            Signed as an HS256 JWT and encrypted with AES-GCM before writing to{" "}
            <code className="font-mono">vault/&lt;projectId&gt;/conn.enc</code>.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {engine === "sqlite" ? (
            <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-medium">SQLite database file</p>
                  <p className="text-xs text-muted-foreground">
                    Selected:{" "}
                    <strong className="font-mono text-foreground">
                      {sqlitePicked?.name ?? existingSqliteName ?? "None"}
                    </strong>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onPickSqlite}>
                    <FileUp /> Pick .db file...
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={onLoadSampleSqlite}>
                    <Sparkles /> Use sample DB
                  </Button>
                </div>
              </div>

              <Field
                label="Logical database name (used for export folder)"
                htmlFor="proj-db"
              >
                <Input
                  id="proj-db"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="sample_store"
                  required
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Host" htmlFor="proj-host">
                <Input
                  id="proj-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="127.0.0.1"
                  required
                />
              </Field>

              <Field label="Port" htmlFor="proj-port">
                <Input
                  id="proj-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder={String(adapter.defaultPort ?? "")}
                />
              </Field>

              <Field
                label={engine === "cassandra" ? "Keyspace" : engine === "oracle" ? "Service name / SID" : "Database"}
                htmlFor="proj-db"
              >
                <Input
                  id="proj-db"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder={engine === "redis" ? "default" : "app_db"}
                  required
                />
              </Field>

              <Field label="Default schema (optional)" htmlFor="proj-schema">
                <Input
                  id="proj-schema"
                  value={schema}
                  onChange={(e) => setSchema(e.target.value)}
                  placeholder={engine === "mssql" ? "dbo" : engine === "postgres" ? "public" : ""}
                />
              </Field>

              <Field label="Username" htmlFor="proj-user">
                <Input
                  id="proj-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </Field>

              <Field label="Password (encrypted at rest)" htmlFor="proj-pass">
                <div className="relative">
                  <Input
                    id="proj-pass"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>

              <Field label="SSL / TLS mode" htmlFor="proj-ssl">
                <NativeSelect id="proj-ssl" value={ssl} onChange={(e) => setSsl(e.target.value as SslMode)}>
                  <option value="disable">Disable</option>
                  <option value="require">Require</option>
                  <option value="verify-full">Verify full</option>
                </NativeSelect>
              </Field>

              {engine === "mongodb" ? (
                <Field label="Auth source" htmlFor="proj-authsource">
                  <Input id="proj-authsource" value={authSource} onChange={(e) => setAuthSource(e.target.value)} />
                </Field>
              ) : null}

              {engine === "redis" ? (
                <Field label="Redis DB index" htmlFor="proj-redis-idx">
                  <Input
                    id="proj-redis-idx"
                    type="number"
                    min={0}
                    max={15}
                    value={redisDbIndex}
                    onChange={(e) => setRedisDbIndex(e.target.value)}
                  />
                </Field>
              ) : null}

              {engine === "cassandra" ? (
                <Field label="Local datacenter" htmlFor="proj-dc">
                  <Input id="proj-dc" value={datacenter} onChange={(e) => setDatacenter(e.target.value)} />
                </Field>
              ) : null}

              <Field
                label="SSH / tunnel hint (stored as text reminder only)"
                htmlFor="proj-ssh"
                className="sm:col-span-2"
              >
                <Input
                  id="proj-ssh"
                  value={sshHint}
                  onChange={(e) => setSshHint(e.target.value)}
                  placeholder="ssh -L 5432:db.internal:5432 bastion"
                />
              </Field>
            </div>
          )}

          {testResult ? (
            <ConnectionTestResult
              result={testResult}
              onRetry={onTestDraft}
              retrying={testing}
              onDismiss={() => setTestResult(null)}
            />
          ) : null}

          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </CardContent>

        <CardFooter className="justify-between">
          <Button type="button" variant="outline" onClick={onTestDraft} disabled={testing || busy}>
            {testing ? <Spinner /> : <Plug />}
            Test Connection
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {existing ? "Save changes" : "Create project"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
