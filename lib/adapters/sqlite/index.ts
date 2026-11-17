import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { CATEGORY_MAP } from "../categories";
import { ConnectionError, failureFromError } from "../diagnostics";
import type {
  AdapterExtractionOutput,
  ConnectionHandle,
  DbAdapter,
  ProgressEvent,
  ResolvedConnection,
  SqlFile,
  TestResult,
} from "../types";
import type { ExtractionOptions, ObjectCategory } from "@/lib/schemas";
import { resolveExtractionOptions } from "@/lib/schemas";
import { buildInsertBatches, quoteIdent } from "@/lib/bridge/sql-literals";
import { readSqliteBytes } from "@/lib/storage";
import { slug } from "@/lib/utils/slug";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs(
      typeof window !== "undefined" ? { locateFile: (file) => `/${file}` } : undefined,
    ).catch((err: unknown) => {
      sqlJsPromise = null;
      throw err;
    });
  }
  return sqlJsPromise;
}

interface SqliteHandle {
  db: Database;
  databaseName: string;
}

interface MasterRow {
  type: "table" | "index" | "view" | "trigger";
  name: string;
  tbl_name: string;
  sql: string;
}

function isExcludedObject(name: string, opts: ExtractionOptions): boolean {
  if (opts.excludeSystemSchemas && name.toLowerCase().startsWith("sqlite_")) return true;
  return opts.excludedSchemas.some((p) => p && name.toLowerCase().startsWith(p.toLowerCase()));
}

function normalizeSql(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  return `${trimmed};`;
}

function applyIfNotExists(sql: string, kind: "TABLE" | "VIEW" | "INDEX" | "TRIGGER"): string {
  const re = new RegExp(`^(\\s*CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?(?:UNIQUE\\s+)?${kind}\\s+)(?!IF\\s+NOT\\s+EXISTS\\b)`, "i");
  return sql.replace(re, "$1IF NOT EXISTS ");
}

function formatObjectDdl(
  row: MasterRow,
  kind: "TABLE" | "VIEW" | "INDEX" | "TRIGGER",
  opts: ExtractionOptions,
): string {
  const lines: string[] = [];
  if (opts.dropFirst) {
    lines.push(`DROP ${kind} IF EXISTS "${row.name.replaceAll('"', '""')}";`);
  }
  const body = opts.useIfNotExists ? applyIfNotExists(row.sql, kind) : row.sql;
  lines.push(normalizeSql(body));
  return lines.join("\n");
}

function buildFileHeader(category: ObjectCategory, databaseName: string, opts: ExtractionOptions): string {
  const lines: string[] = [];
  if (opts.includeHeaderComments) {
    lines.push(`-- HHP Database Extractor`);
    lines.push(`-- Engine: SQLite | Database: ${databaseName} | Category: ${CATEGORY_MAP[category].label}`);
  }
  if (opts.includeUseDatabaseHeader) {
    lines.push(`-- Attached database: ${databaseName}`);
    lines.push(`PRAGMA foreign_keys = ON;`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}

function queryMasterRows(db: Database, opts: ExtractionOptions): MasterRow[] {
  const res = db.exec(
    `SELECT type, name, tbl_name, sql
       FROM sqlite_master
      WHERE sql IS NOT NULL
      ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'view' THEN 2 WHEN 'index' THEN 3 WHEN 'trigger' THEN 4 ELSE 5 END,
               LOWER(name), name`,
  );
  if (res.length === 0) return [];
  const out: MasterRow[] = [];
  for (const row of res[0].values) {
    const [type, name, tblName, sql] = row as [MasterRow["type"], string, string, string];
    if (isExcludedObject(name, opts) || isExcludedObject(tblName, opts)) continue;
    out.push({ type, name, tbl_name: tblName, sql });
  }
  return out;
}

function extractColumnAndKeyMetadata(db: Database, tables: MasterRow[]) {
  const columnBlocks: { table: string; content: string }[] = [];
  const pkBlocks: { table: string; content: string }[] = [];
  const fkBlocks: { table: string; content: string }[] = [];

  for (const t of tables) {
    const safeIdent = t.name.replaceAll('"', '""');
    const info = db.exec(`PRAGMA table_info("${safeIdent}")`);
    if (info.length > 0 && info[0].values.length > 0) {
      const cols = info[0].values.map((r) => {
        const [, colName, colType, notNull, dflt, pk] = r as [number, string, string, number, string | null, number];
        const parts = [`"${colName}"`, colType || "ANY"];
        if (notNull) parts.push("NOT NULL");
        if (dflt !== null) parts.push(`DEFAULT ${dflt}`);
        if (pk > 0) parts.push(`PRIMARY KEY (${pk})`);
        return `  ${parts.join(" ")}`;
      });
      columnBlocks.push({
        table: t.name,
        content: `-- Table: "${t.name}"\n${cols.join(",\n")};`,
      });

      const pkCols = info[0].values
        .filter((r) => (r[5] as number) > 0)
        .sort((a, b) => (a[5] as number) - (b[5] as number))
        .map((r) => `"${r[1] as string}"`);
      if (pkCols.length > 0) {
        pkBlocks.push({
          table: t.name,
          content: `-- Table "${t.name}" PRIMARY KEY (${pkCols.join(", ")});`,
        });
      }
    }

    const fks = db.exec(`PRAGMA foreign_key_list("${safeIdent}")`);
    if (fks.length > 0 && fks[0].values.length > 0) {
      const grouped = new Map<
        number,
        { refTable: string; from: string[]; to: string[]; onUpdate: string; onDelete: string }
      >();
      for (const r of fks[0].values) {
        const [id, , refTable, fromCol, toCol, onUpdate, onDelete] = r as [
          number,
          number,
          string,
          string,
          string,
          string,
          string,
        ];
        const g = grouped.get(id) ?? { refTable, from: [], to: [], onUpdate, onDelete };
        g.from.push(`"${fromCol}"`);
        g.to.push(`"${toCol}"`);
        grouped.set(id, g);
      }
      const lines = [...grouped.values()].map(
        (g) =>
          `-- Table "${t.name}": FOREIGN KEY (${g.from.join(", ")}) REFERENCES "${g.refTable}" (${g.to.join(
            ", ",
          )}) ON UPDATE ${g.onUpdate} ON DELETE ${g.onDelete};`,
      );
      fkBlocks.push({ table: t.name, content: lines.join("\n") });
    }
  }

  return { columnBlocks, pkBlocks, fkBlocks };
}

async function openDatabase(cfg: ResolvedConnection): Promise<{ db: Database; version: string }> {
  let SQL: SqlJsStatic;
  try {
    SQL = await getSqlJs();
  } catch (err) {
    throw new ConnectionError(
      failureFromError(err, {
        code: "SQLITE_ENGINE_LOAD_FAILED",
        stage: "driver",
        title: "Could not load the in-browser SQLite engine",
        hint: "The sql.js WASM file is served from /sql-wasm-browser.wasm. Re-run `npm install` (it copies the file into public/) and make sure the app server is running.",
      }),
    );
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = cfg.sqliteBytes ?? (await readSqliteBytes(cfg.projectId));
  } catch (err) {
    throw new ConnectionError(
      failureFromError(err, {
        code: "SQLITE_FILE_READ_FAILED",
        stage: "vault",
        title: "Could not read the stored SQLite file",
        hint: "Edit the project and pick the .db file again; the stored copy may be missing or unreadable.",
      }),
    );
  }

  let db: Database | undefined;
  try {
    db = new SQL.Database(bytes);
    const verRes = db.exec("SELECT sqlite_version()");
    db.exec("SELECT count(*) FROM sqlite_master");
    const version = (verRes[0]?.values?.[0]?.[0] as string | undefined) ?? "3.x";
    return { db, version: `SQLite ${version}` };
  } catch (err) {
    db?.close();
    throw new ConnectionError(
      failureFromError(err, {
        code: "SQLITE_OPEN_FAILED",
        stage: "driver",
        title: "SQLite could not open this file",
        hint: "Make sure the file is a SQLite 3 database (not a CSV/backup/encrypted DB) and is not empty.",
      }),
    );
  }
}

export const sqliteAdapter: DbAdapter = {
  engine: "sqlite",
  displayName: "SQLite",
  requiresNetwork: false,
  supportedInCurrentMilestone: true,

  async testConnection(cfg: ResolvedConnection): Promise<TestResult> {
    const started = performance.now();
    try {
      const { db, version } = await openDatabase(cfg);
      db.close();
      return {
        ok: true,
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
        serverVersion: version,
      };
    } catch (err) {
      const failure = failureFromError(err);
      return {
        ok: false,
        latencyMs: Math.max(1, Math.round(performance.now() - started)),
        message: failure.message,
        failure,
      };
    }
  },

  async connect(cfg: ResolvedConnection): Promise<ConnectionHandle> {
    const { db, version } = await openDatabase(cfg);
    const raw: SqliteHandle = { db, databaseName: cfg.database };
    return { engine: "sqlite", serverVersion: version, raw };
  },

  async close(conn: ConnectionHandle): Promise<void> {
    (conn.raw as SqliteHandle).db.close();
  },

  async extractAll(
    conn: ConnectionHandle,
    rawOpts: ExtractionOptions,
    onProgress: (evt: ProgressEvent) => void,
  ): Promise<AdapterExtractionOutput> {
    const opts = resolveExtractionOptions(rawOpts);
    onProgress({ kind: "phase", phase: "extract" });
    const { db, databaseName } = conn.raw as SqliteHandle;
    const rows = queryMasterRows(db, opts);
    const warnings: string[] = [];
    const binaryFiles: AdapterExtractionOutput["binaryFiles"] = [];

    const tables = rows.filter((r) => r.type === "table");
    const views = rows.filter((r) => r.type === "view");
    const indexes = rows.filter((r) => r.type === "index");
    const triggers = rows.filter((r) => r.type === "trigger");

    const files: SqlFile[] = [];
    const counts: Partial<Record<ObjectCategory, number>> = {};

    function emitCategory(
      category: ObjectCategory,
      items: { name: string; ddl: string }[],
      schemaPrefix = "main",
    ) {
      counts[category] = items.length;
      onProgress({ kind: "category", category, done: items.length, total: items.length });
      if (items.length === 0) return;

      const header = buildFileHeader(category, databaseName, opts);
      const bulkBody = items.map((i) => i.ddl).join("\n\n") + "\n";
      files.push({
        filename: CATEGORY_MAP[category].bulkFilename,
        category,
        content: header + bulkBody,
        sha256: "",
      });

      if (opts.splitPerObject) {
        const folder = CATEGORY_MAP[category].objectFolder;
        for (const item of items) {
          files.push({
            filename: `objects/${folder}/${schemaPrefix}.${slug(item.name)}.sql`,
            category,
            content: `${header}${item.ddl}\n`,
            sha256: "",
          });
        }
      }
    }

    if (opts.includeTables) {
      emitCategory(
        "tables",
        tables.map((r) => ({ name: r.name, ddl: formatObjectDdl(r, "TABLE", opts) })),
      );
    }

    if (opts.includeColumns || opts.includeKeys) {
      const { columnBlocks, pkBlocks, fkBlocks } = extractColumnAndKeyMetadata(db, tables);
      if (opts.includeColumns) {
        emitCategory(
          "columns",
          columnBlocks.map((b) => ({ name: b.table, ddl: b.content })),
        );
      }
      if (opts.includeKeys) {
        emitCategory(
          "primary_keys",
          pkBlocks.map((b) => ({ name: b.table, ddl: b.content })),
        );
        emitCategory(
          "foreign_keys",
          fkBlocks.map((b) => ({ name: b.table, ddl: b.content })),
        );
      }
    }

    if (opts.includeIndexes) {
      emitCategory(
        "indexes",
        indexes.map((r) => ({ name: r.name, ddl: formatObjectDdl(r, "INDEX", opts) })),
      );
    }

    if (opts.includeViews) {
      emitCategory(
        "views",
        views.map((r) => ({ name: r.name, ddl: formatObjectDdl(r, "VIEW", opts) })),
      );
    }

    if (opts.includeTriggers) {
      emitCategory(
        "triggers",
        triggers.map((r) => ({ name: r.name, ddl: formatObjectDdl(r, "TRIGGER", opts) })),
      );
    }

    if (opts.mode === "native") {
      try {
        const exported = db.export();
        binaryFiles.push({
          filename: "native/database.db",
          base64:
            typeof Buffer !== "undefined"
              ? Buffer.from(exported).toString("base64")
              : btoa(Array.from(exported, (b) => String.fromCharCode(b)).join("")),
        });
        warnings.push("Native SQLite file written to native/database.db");
      } catch (err) {
        warnings.push(
          `Native SQLite copy failed: ${err instanceof Error ? err.message : String(err)}; falling back to SQL data dump.`,
        );
      }
    }

    if (opts.includeTableData && !(opts.mode === "native" && binaryFiles.length > 0)) {
      const batchSize = opts.dataBatchSize ?? 500;
      const parts: string[] = [];
      if (opts.includeHeaderComments) {
        parts.push("-- HHP Database Extractor — table data");
        parts.push(`-- Database: ${databaseName}`);
        parts.push("");
      }
      parts.push("PRAGMA foreign_keys = OFF;");
      parts.push("BEGIN TRANSACTION;");
      parts.push("");
      let totalRows = 0;
      for (const table of tables) {
        try {
          const info = db.exec(`PRAGMA table_info("${table.name.replaceAll('"', '""')}")`);
          const colNames =
            info[0]?.values.map((v) => String(v[1])) ??
            [];
          if (colNames.length === 0) continue;
          const qualified = quoteIdent(table.name, "sqlite");
          const dataRes = db.exec(`SELECT * FROM ${qualified}`);
          const values = dataRes[0]?.values ?? [];
          const columns = dataRes[0]?.columns ?? colNames;
          const rowObjs = values.map((row) => {
            const obj: Record<string, unknown> = {};
            columns.forEach((c, i) => {
              obj[c] = row[i];
            });
            return obj;
          });
          const tableSql = [
            `-- Data for ${qualified}`,
            ...buildInsertBatches(qualified, columns, rowObjs, "sqlite", batchSize),
            "",
          ];
          totalRows += rowObjs.length;
          const body = `${tableSql.join("\n")}\n`;
          parts.push(body);
          if (opts.splitPerObject) {
            files.push({
              filename: `objects/${CATEGORY_MAP.table_data.objectFolder}/main.${slug(table.name)}.sql`,
              category: "table_data",
              content: body,
              sha256: "",
            });
          }
        } catch (err) {
          warnings.push(
            `Data dump failed for ${table.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      parts.push("COMMIT;");
      parts.push("PRAGMA foreign_keys = ON;");
      parts.push("");
      files.push({
        filename: CATEGORY_MAP.table_data.bulkFilename,
        category: "table_data",
        content: parts.join("\n"),
        sha256: "",
      });
      counts.table_data = totalRows;
      onProgress({ kind: "category", category: "table_data", done: totalRows, total: totalRows });
      warnings.push(`Exported data for ${tables.length} table(s), ${totalRows} total row(s).`);
    }

    return {
      files,
      counts,
      warnings,
      serverVersion: conn.serverVersion,
      binaryFiles: binaryFiles.length > 0 ? binaryFiles : undefined,
    };
  },
};
