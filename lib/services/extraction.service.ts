import { zipSync, strToU8 } from "fflate";
import { registry } from "@/lib/adapters/registry";
import type { ProgressEvent, ResolvedConnection } from "@/lib/adapters/types";
import { ManifestSchema, type ExtractionOptions, type Manifest, type ObjectCategory } from "@/lib/schemas";
import { logger } from "@/lib/services/log.service";
import { loadConnectionConfig, loadProjects, markProjectTimestamp } from "@/lib/services/project.service";
import { storage } from "@/lib/storage";
import { formatSnapshotTimestamp } from "@/lib/utils/datetime";
import { fromBase64Url, toBase64Url } from "@/lib/utils/encoding";
import { sha256Hex, utf8ByteLength } from "@/lib/utils/sha256";
import { slug } from "@/lib/utils/slug";
import { useProjectStore } from "@/stores/project.store";

export interface ExtractionRunOutput {
  runId: string;
  dir: string;
  manifest: Manifest;
}

export interface SnapshotSummary {
  runId: string;
  dir: string;
  partial: boolean;
  manifest: Manifest;
}

export function encodeRunId(dir: string): string {
  return toBase64Url(dir.replace(/^\/+|\/+$/g, ""));
}

export function decodeRunId(runId: string): string {
  return fromBase64Url(runId);
}

export async function runExtraction(
  projectId: string,
  options: ExtractionOptions,
  onProgress: (evt: ProgressEvent) => void,
  override?: Partial<ResolvedConnection>,
  now = new Date(),
): Promise<ExtractionRunOutput> {
  const store = useProjectStore.getState();
  const list = store.loaded ? store.projects : await loadProjects();
  const project = list.find((p) => p.id === projectId);
  if (!project) throw new Error("Project not found");

  if (!(await storage.requestPermission())) {
    throw new Error("Storage folder permission is required before extracting.");
  }

  const cfg = await loadConnectionConfig(projectId);
  const adapter = registry[project.engine];
  const started = Date.now();
  const { iso, dateFolder, timestampFolder } = formatSnapshotTimestamp(now);
  const dir = `exports/${slug(project.name)}/${slug(cfg.database)}/${dateFolder}/${timestampFolder}`;

  logger.info("extract", `Starting extraction for "${project.name}" (${project.engine}) -> ${dir}`);
  await storage.ensureDir(dir);

  let conn: Awaited<ReturnType<typeof adapter.connect>> | null = null;
  try {
    onProgress({ kind: "phase", phase: "connect" });
    conn = await adapter.connect({ ...cfg, ...override });

    const { files, counts, warnings, serverVersion, binaryFiles } = await adapter.extractAll(
      conn,
      options,
      onProgress,
    );

    onProgress({ kind: "phase", phase: "write" });
    const manifestFiles: Manifest["files"] = [];
    for (const file of files) {
      file.sha256 = await sha256Hex(file.content);
      const bytes = utf8ByteLength(file.content);
      await storage.writeTextFile(`${dir}/${file.filename}`, file.content);
      manifestFiles.push({
        path: file.filename,
        sha256: file.sha256,
        bytes,
        category: file.category,
      });
      onProgress({ kind: "object", category: file.category, name: file.filename });
    }

    for (const bin of binaryFiles ?? []) {
      const raw =
        typeof Buffer !== "undefined"
          ? new Uint8Array(Buffer.from(bin.base64, "base64"))
          : Uint8Array.from(atob(bin.base64), (c) => c.charCodeAt(0));
      const hash = await sha256Hex(bin.base64);
      if (storage.writeBinaryFile) {
        await storage.writeBinaryFile(`${dir}/${bin.filename}`, raw);
      } else {
        await storage.writeTextFile(`${dir}/${bin.filename}.b64`, bin.base64);
      }
      manifestFiles.push({
        path: bin.filename,
        sha256: hash,
        bytes: raw.byteLength,
        category: "table_data",
      });
      onProgress({ kind: "object", category: "table_data", name: bin.filename });
    }

    onProgress({ kind: "phase", phase: "manifest" });
    const durationMs = Math.max(1, Date.now() - started);
    const normalizedCounts: Record<ObjectCategory | string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      if (typeof v === "number") normalizedCounts[k] = v;
    }

    const manifest: Manifest = ManifestSchema.parse({
      version: 1,
      projectId: project.id,
      projectName: project.name,
      engine: project.engine,
      database: cfg.database,
      extractedAt: iso,
      durationMs,
      serverVersion: serverVersion ?? conn.serverVersion,
      counts: normalizedCounts,
      files: manifestFiles,
      warnings,
      options,
    });

    await storage.writeTextFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));

    onProgress({ kind: "phase", phase: "close" });
    await adapter.close(conn);
    conn = null;

    await markProjectTimestamp(project.id, "lastExtractedAt", iso);
    logger.info("extract", `Completed extraction for "${project.name}" (${manifestFiles.length} files, ${durationMs} ms)`);
    return { runId: encodeRunId(dir), dir, manifest };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress({ kind: "error", message });
    logger.error("extract", `Extraction failed for "${project.name}": ${message}`);
    try {
      await storage.writeTextFile(
        `${dir}/_partial`,
        JSON.stringify({ failedAt: new Date().toISOString(), error: message }, null, 2),
      );
    } catch {
      // Ignore secondary failure writing _partial marker.
    }
    throw err;
  } finally {
    if (conn) {
      try {
        await adapter.close(conn);
      } catch {
        // Ignore close error.
      }
    }
  }
}

/**
 * Walks `exports/<project>/<db>/<date>/<timestamp>/manifest.json` and returns
 * every snapshot sorted newest-first.
 */
export async function listSnapshots(filterProjectId?: string): Promise<SnapshotSummary[]> {
  if (!(await storage.exists("exports"))) return [];
  const summaries: SnapshotSummary[] = [];

  const projectDirs = await storage.listDir("exports");
  for (const projEntry of projectDirs) {
    if (projEntry.kind !== "directory") continue;
    const dbDirs = await storage.listDir(`exports/${projEntry.name}`);
    for (const dbEntry of dbDirs) {
      if (dbEntry.kind !== "directory") continue;
      const dateDirs = await storage.listDir(`exports/${projEntry.name}/${dbEntry.name}`);
      for (const dateEntry of dateDirs) {
        if (dateEntry.kind !== "directory") continue;
        const tsDirs = await storage.listDir(`exports/${projEntry.name}/${dbEntry.name}/${dateEntry.name}`);
        for (const tsEntry of tsDirs) {
          if (tsEntry.kind !== "directory") continue;
          const dir = `exports/${projEntry.name}/${dbEntry.name}/${dateEntry.name}/${tsEntry.name}`;
          const manifestPath = `${dir}/manifest.json`;
          if (!(await storage.exists(manifestPath))) continue;
          try {
            const manifest = ManifestSchema.parse(JSON.parse(await storage.readTextFile(manifestPath)));
            if (filterProjectId && manifest.projectId !== filterProjectId) continue;
            const partial = await storage.exists(`${dir}/_partial`);
            summaries.push({ runId: encodeRunId(dir), dir, partial, manifest });
          } catch {
            // Skip malformed manifest.
          }
        }
      }
    }
  }

  return summaries.sort((a, b) => b.manifest.extractedAt.localeCompare(a.manifest.extractedAt));
}

export async function loadSnapshotByRunId(runId: string): Promise<SnapshotSummary> {
  const dir = decodeRunId(runId);
  const manifest = ManifestSchema.parse(JSON.parse(await storage.readTextFile(`${dir}/manifest.json`)));
  const partial = await storage.exists(`${dir}/_partial`);
  return { runId, dir, partial, manifest };
}

export async function readSnapshotFile(dir: string, relativePath: string): Promise<string> {
  return storage.readTextFile(`${dir}/${relativePath}`);
}

export async function buildSnapshotZip(dir: string, manifest: Manifest): Promise<Uint8Array<ArrayBuffer>> {
  const entries: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  };
  for (const f of manifest.files) {
    const content = await storage.readTextFile(`${dir}/${f.path}`);
    entries[f.path] = strToU8(content);
  }
  return new Uint8Array(zipSync(entries, { level: 6 }));
}

export async function downloadSnapshotZip(dir: string, manifest: Manifest): Promise<void> {
  const bytes = await buildSnapshotZip(dir, manifest);
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = manifest.extractedAt.slice(0, 19).replaceAll(":", "-");
  a.href = url;
  a.download = `${slug(manifest.projectName)}_${slug(manifest.database)}_${stamp}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
