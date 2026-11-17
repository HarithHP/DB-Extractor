import { z } from "zod";
import { failureFromError, makeFailure, type ConnectionFailure } from "@/lib/adapters/diagnostics";
import { registry } from "@/lib/adapters/registry";
import type { ResolvedConnection, TestResult } from "@/lib/adapters/types";
import type { DekKeys } from "@/lib/crypto/kdf";
import { seal, unseal } from "@/lib/crypto/vault";
import {
  ConnectionConfigSchema,
  ProjectNameSchema,
  ProjectSchema,
  type ConnectionConfig,
  type EngineId,
  type Project,
} from "@/lib/schemas";
import { logger, registerSecretForRedaction } from "@/lib/services/log.service";
import { deleteSqliteFile, saveSqliteFile, storage, type PickedSqliteFile } from "@/lib/storage";
import { useAuthStore } from "@/stores/auth.store";
import { useProjectStore } from "@/stores/project.store";

const PROJECTS_PATH = "vault/projects.enc";
const connPath = (id: string) => `vault/${id}/conn.enc`;

const ProjectsVaultSchema = z.object({
  projects: z.array(ProjectSchema),
});

function requireDek(): DekKeys {
  const dek = useAuthStore.getState().dek;
  if (!dek) throw new Error("Vault is locked");
  return dek;
}

export async function loadProjects(): Promise<Project[]> {
  const dek = requireDek();
  if (!(await storage.exists(PROJECTS_PATH))) {
    useProjectStore.getState().setProjects([]);
    return [];
  }
  const env = JSON.parse(await storage.readTextFile(PROJECTS_PATH));
  const payload = await unseal<unknown>(dek, env);
  const { projects } = ProjectsVaultSchema.parse(payload);
  useProjectStore.getState().setProjects(projects);
  return projects;
}

async function persistProjectList(projects: Project[]) {
  const dek = requireDek();
  await storage.ensureDir("vault");
  const env = await seal(dek, { projects });
  await storage.writeTextFile(PROJECTS_PATH, JSON.stringify(env, null, 2));
}

export async function loadConnectionConfig(projectId: string): Promise<ConnectionConfig> {
  const dek = requireDek();
  const env = JSON.parse(await storage.readTextFile(connPath(projectId)));
  const raw = await unseal<unknown>(dek, env);
  const cfg = ConnectionConfigSchema.parse(raw);
  registerSecretForRedaction(cfg.password);
  return cfg;
}

async function persistConnectionConfig(cfg: ConnectionConfig) {
  const dek = requireDek();
  const valid = ConnectionConfigSchema.parse(cfg);
  registerSecretForRedaction(valid.password);
  await storage.ensureDir(`vault/${valid.projectId}`);
  const env = await seal(dek, valid);
  await storage.writeTextFile(connPath(valid.projectId), JSON.stringify(env, null, 2));
}

export interface ProjectInput {
  name: string;
  engine: EngineId;
  tags: string[];
  notes?: string;
  connection: Omit<ConnectionConfig, "projectId" | "engine" | "iat">;
  sqliteFile?: PickedSqliteFile;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const name = ProjectNameSchema.parse(input.name);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const project: Project = ProjectSchema.parse({
    id,
    name,
    engine: input.engine,
    tags: input.tags.map((t) => t.trim()).filter(Boolean),
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  });

  if (input.engine === "sqlite" && input.sqliteFile) {
    await saveSqliteFile(id, input.sqliteFile);
  }

  await persistConnectionConfig({
    ...input.connection,
    projectId: id,
    engine: input.engine,
  });

  const store = useProjectStore.getState();
  const current = store.loaded ? store.projects : await loadProjects();
  const next = [project, ...current];
  await persistProjectList(next);
  store.setProjects(next);
  logger.info("project", `Created project "${project.name}" (${project.engine})`);
  return project;
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  const name = ProjectNameSchema.parse(input.name);
  const store = useProjectStore.getState();
  const current = store.loaded ? store.projects : await loadProjects();
  const existing = current.find((p) => p.id === id);
  if (!existing) throw new Error("Project not found");

  const updated: Project = ProjectSchema.parse({
    ...existing,
    name,
    engine: input.engine,
    tags: input.tags.map((t) => t.trim()).filter(Boolean),
    notes: input.notes?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  });

  if (input.engine === "sqlite" && input.sqliteFile) {
    await saveSqliteFile(id, input.sqliteFile);
  }

  await persistConnectionConfig({
    ...input.connection,
    projectId: id,
    engine: input.engine,
  });

  const next = current.map((p) => (p.id === id ? updated : p));
  await persistProjectList(next);
  store.setProjects(next);
  logger.info("project", `Updated project "${updated.name}"`);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
  const store = useProjectStore.getState();
  const current = store.loaded ? store.projects : await loadProjects();
  const target = current.find((p) => p.id === id);
  const next = current.filter((p) => p.id !== id);
  await persistProjectList(next);
  await storage.deletePath(`vault/${id}`);
  await deleteSqliteFile(id);
  store.setProjects(next);
  logger.info("project", `Deleted project "${target?.name ?? id}"`);
}

export async function markProjectTimestamp(
  id: string,
  field: "lastExtractedAt" | "lastTestOkAt",
  iso = new Date().toISOString(),
): Promise<void> {
  const store = useProjectStore.getState();
  const current = store.loaded ? store.projects : await loadProjects();
  const next = current.map((p) => (p.id === id ? { ...p, [field]: iso, updatedAt: iso } : p));
  await persistProjectList(next);
  store.setProjects(next);
}

/** host:port/database for display and logs; never includes the password. */
export function describeConnectionTarget(engine: EngineId, cfg: Partial<ConnectionConfig>): string {
  if (engine === "sqlite") return cfg.database ? `${cfg.database} (local .db file)` : "local .db file";
  const user = cfg.username ? `${cfg.username}@` : "";
  const host = cfg.host || "127.0.0.1";
  const port = cfg.port ? `:${cfg.port}` : "";
  return `${user}${host}${port}/${cfg.database || ""}`;
}

function failedResult(failure: ConnectionFailure, latencyMs = 0): TestResult {
  return { ok: false, latencyMs, message: failure.message, failure };
}

/**
 * Single entry point for every "Test Connection" button. Never throws: any error
 * becomes a structured `failure`, and every outcome is logged (redacted).
 */
export async function runConnectionTest(
  engine: EngineId,
  cfg: ResolvedConnection,
  label: string,
): Promise<TestResult> {
  const testedAt = new Date().toISOString();
  const target = describeConnectionTarget(engine, cfg);
  registerSecretForRedaction(cfg.password);

  let res: TestResult;
  try {
    res = await registry[engine].testConnection(cfg);
  } catch (err) {
    res = failedResult(failureFromError(err));
  }
  if (!res.ok && !res.failure) {
    res = { ...res, failure: failureFromError(new Error(res.message ?? "Connection failed")) };
  }
  const result: TestResult = { ...res, engine, target, testedAt };

  if (result.ok) {
    logger.info("connection", `Connection OK for "${label}" → ${target} (${result.latencyMs} ms, ${result.serverVersion ?? "?"})`);
  } else if (result.failure) {
    const f = result.failure;
    logger.warn("connection", `Connection test failed for "${label}" → ${target}: [${f.code}] ${f.message}`, {
      code: f.code,
      stage: f.stage,
      httpStatus: f.httpStatus,
      endpoint: f.endpoint,
    });
  }
  return result;
}

export async function testProjectConnection(
  id: string,
  override?: Partial<ResolvedConnection>,
): Promise<TestResult> {
  const store = useProjectStore.getState();
  const list = store.loaded ? store.projects : await loadProjects().catch(() => []);
  const project = list.find((p) => p.id === id);
  if (!project) {
    return failedResult(
      makeFailure({
        code: "VAULT_READ_FAILED",
        stage: "vault",
        title: "Project not found",
        message: `No project with id "${id}" exists in vault/projects.enc.`,
        hint: "Go back to Projects and pick it from the list again.",
      }),
    );
  }

  let cfg: ConnectionConfig;
  try {
    cfg = await loadConnectionConfig(id);
  } catch (err) {
    const result = failedResult(
      failureFromError(err, {
        code: "VAULT_READ_FAILED",
        stage: "vault",
        title: "Could not decrypt this project's saved connection",
        hint: `The file ${connPath(id)} is missing or unreadable. Edit the project and save the connection again.`,
      }),
    );
    logger.warn("connection", `Connection test failed for "${project.name}": [VAULT_READ_FAILED] ${result.message}`);
    return { ...result, engine: project.engine, testedAt: new Date().toISOString() };
  }

  const res = await runConnectionTest(project.engine, { ...cfg, ...override }, project.name);
  if (res.ok) await markProjectTimestamp(id, "lastTestOkAt");
  return res;
}
