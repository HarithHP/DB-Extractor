import { z } from "zod";
import { PROJECT_NAME_REGEX } from "@/lib/utils/slug";

export const ENGINE_IDS = [
  "sqlite",
  "postgres",
  "mysql",
  "mariadb",
  "mssql",
  "oracle",
  "mongodb",
  "redis",
  "cassandra",
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export const EngineIdSchema = z.enum(ENGINE_IDS);

export const OBJECT_CATEGORIES = [
  "tables",
  "columns",
  "primary_keys",
  "foreign_keys",
  "indexes",
  "constraints",
  "views",
  "functions",
  "procedures",
  "triggers",
  "sequences",
  "synonyms",
  "schemas",
  "roles",
  "extensions",
  "collections",
  "table_data",
] as const;

export const EXTRACTION_MODES = ["schema", "full_sql", "native"] as const;
export type ExtractionMode = (typeof EXTRACTION_MODES)[number];
export const ExtractionModeSchema = z.enum(EXTRACTION_MODES);

export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

export const ObjectCategorySchema = z.enum(OBJECT_CATEGORIES);

export const EnvelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal("AES-GCM"),
  iv: z.string().min(1),
  ct: z.string().min(1),
  kid: z.string().optional(),
});

export const StoredUserSchema = z.object({
  version: z.literal(1),
  username: z.string().trim().min(1).max(64),
  salt: z.string().min(1),
  iterations: z.number().int().positive(),
  verifier: EnvelopeSchema,
  dekEnvelope: EnvelopeSchema,
  createdAt: z.string(),
});

export type StoredUser = z.infer<typeof StoredUserSchema>;

export const MetaConfigSchema = z.object({
  appVersion: z.string(),
  schemaVersion: z.literal(1),
  createdAt: z.string(),
});

export type MetaConfig = z.infer<typeof MetaConfigSchema>;

export const ProjectNameSchema = z
  .string()
  .trim()
  .min(1, "Project name is required")
  .max(64, "Project name must be at most 64 characters")
  .regex(PROJECT_NAME_REGEX, "Only letters, numbers, spaces, dots, hyphens, and underscores are allowed");

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: ProjectNameSchema,
  engine: EngineIdSchema,
  tags: z.array(z.string()),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastExtractedAt: z.string().optional(),
  lastTestOkAt: z.string().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const SslModeSchema = z.enum(["disable", "require", "verify-full"]);
export type SslMode = z.infer<typeof SslModeSchema>;

export const ConnectionConfigSchema = z.object({
  projectId: z.string().min(1),
  engine: EngineIdSchema,
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  database: z.string().trim().min(1, "Database or file name is required"),
  schema: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  ssl: SslModeSchema.optional(),
  sshHint: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  iat: z.number().optional(),
});

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;

export const ExtractionOptionsSchema = z.object({
  mode: ExtractionModeSchema.default("schema"),
  includeTableData: z.boolean().default(false),
  dataBatchSize: z.number().int().min(1).max(5000).default(500),
  includeTables: z.boolean(),
  includeColumns: z.boolean(),
  includeViews: z.boolean(),
  includeFunctions: z.boolean(),
  includeProcedures: z.boolean(),
  includeTriggers: z.boolean(),
  includeIndexes: z.boolean(),
  includeKeys: z.boolean(),
  includeConstraints: z.boolean(),
  includeSequences: z.boolean(),
  includeSynonyms: z.boolean(),
  includeSchemas: z.boolean(),
  includeRoles: z.boolean(),
  splitPerObject: z.boolean(),
  dropFirst: z.boolean(),
  useIfNotExists: z.boolean(),
  includeUseDatabaseHeader: z.boolean(),
  includeHeaderComments: z.boolean(),
  excludeSystemSchemas: z.boolean(),
  excludedSchemas: z.array(z.string()),
});

export type ExtractionOptions = z.infer<typeof ExtractionOptionsSchema>;

export const DEFAULT_EXTRACTION_OPTIONS: ExtractionOptions = {
  mode: "schema",
  includeTableData: false,
  dataBatchSize: 500,
  includeTables: true,
  includeColumns: true,
  includeViews: true,
  includeFunctions: true,
  includeProcedures: true,
  includeTriggers: true,
  includeIndexes: true,
  includeKeys: true,
  includeConstraints: true,
  includeSequences: true,
  includeSynonyms: true,
  includeSchemas: true,
  includeRoles: false,
  splitPerObject: true,
  dropFirst: false,
  useIfNotExists: true,
  includeUseDatabaseHeader: true,
  includeHeaderComments: true,
  excludeSystemSchemas: true,
  excludedSchemas: ["sys", "information_schema", "pg_catalog", "sqlite_"],
};

/** Resolve mode flags so callers can pass either `mode` or `includeTableData`. */
export function resolveExtractionOptions(opts: ExtractionOptions): ExtractionOptions {
  const mode = opts.mode ?? (opts.includeTableData ? "full_sql" : "schema");
  const includeTableData = mode === "full_sql" || mode === "native" || opts.includeTableData;
  return {
    ...opts,
    mode,
    includeTableData,
    dataBatchSize: opts.dataBatchSize ?? 500,
  };
}

export const ManifestFileEntrySchema = z.object({
  path: z.string(),
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
  category: ObjectCategorySchema,
});

export const ManifestSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  projectName: z.string(),
  engine: EngineIdSchema,
  database: z.string(),
  extractedAt: z.string(),
  durationMs: z.number().nonnegative(),
  serverVersion: z.string().optional(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  files: z.array(ManifestFileEntrySchema),
  warnings: z.array(z.string()),
  options: ExtractionOptionsSchema,
});

export type Manifest = z.infer<typeof ManifestSchema>;

export const AppSettingsSchema = z.object({
  version: z.literal(1),
  writeDiskLogs: z.boolean(),
  defaultOptions: ExtractionOptionsSchema,
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  writeDiskLogs: false,
  defaultOptions: DEFAULT_EXTRACTION_OPTIONS,
};
