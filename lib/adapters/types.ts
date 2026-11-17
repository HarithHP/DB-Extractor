import type { ConnectionConfig, EngineId, ExtractionOptions, ObjectCategory } from "@/lib/schemas";
import type { ConnectionFailure } from "./diagnostics";

export interface ResolvedConnection extends ConnectionConfig {
  /** Pre-loaded SQLite file bytes when running in the browser or in tests. */
  sqliteBytes?: Uint8Array<ArrayBuffer>;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  serverVersion?: string;
  /** Exact failure message (mirrors `failure.message`). */
  message?: string;
  /** Structured diagnostics; present whenever `ok` is false. */
  failure?: ConnectionFailure;
  /** Filled in by the project service. */
  engine?: EngineId;
  /** host:port/database (never includes the password). */
  target?: string;
  testedAt?: string;
}

export interface ConnectionHandle {
  readonly engine: EngineId;
  readonly serverVersion?: string;
  readonly raw: unknown;
}

export interface SqlFile {
  /** Relative path inside the snapshot folder, e.g. `01_tables.sql` or `objects/views/main.v_users.sql`. */
  filename: string;
  category: ObjectCategory;
  content: string;
  sha256: string;
}

export type ProgressEvent =
  | { kind: "phase"; phase: "connect" | "extract" | "write" | "manifest" | "close" }
  | { kind: "category"; category: ObjectCategory; done: number; total?: number }
  | { kind: "object"; category: ObjectCategory; name: string }
  | { kind: "warn"; message: string }
  | { kind: "error"; message: string };

export interface BinaryFile {
  /** Relative path inside the snapshot folder, e.g. `native/database.db`. */
  filename: string;
  /** Base64-encoded bytes. */
  base64: string;
}

export interface AdapterExtractionOutput {
  files: SqlFile[];
  counts: Partial<Record<ObjectCategory, number>>;
  warnings: string[];
  serverVersion?: string;
  binaryFiles?: BinaryFile[];
}

export interface DbAdapter {
  readonly engine: EngineId;
  readonly displayName: string;
  readonly requiresNetwork: boolean;
  readonly supportedInCurrentMilestone: boolean;
  readonly defaultPort?: number;

  testConnection(cfg: ResolvedConnection): Promise<TestResult>;
  connect(cfg: ResolvedConnection): Promise<ConnectionHandle>;
  extractAll(
    conn: ConnectionHandle,
    opts: ExtractionOptions,
    onProgress: (evt: ProgressEvent) => void,
  ): Promise<AdapterExtractionOutput>;
  close(conn: ConnectionHandle): Promise<void>;
}
