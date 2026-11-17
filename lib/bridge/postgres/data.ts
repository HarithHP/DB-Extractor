import type { Client } from "pg";
import { CATEGORY_MAP } from "@/lib/adapters/categories";
import type { SqlFile } from "@/lib/adapters/types";
import type { ExtractionOptions } from "@/lib/schemas";
import { buildInsertBatches, qualifyTable, quoteIdent } from "@/lib/bridge/sql-literals";
import { isExcludedTable } from "@/lib/bridge/schema-filter";
import { slug } from "@/lib/utils/slug";

export interface TableDataDumpResult {
  files: SqlFile[];
  tableCount: number;
  rowCount: number;
  warnings: string[];
}

export async function dumpPostgresTableData(
  client: Client,
  opts: ExtractionOptions,
  databaseName: string,
): Promise<TableDataDumpResult> {
  const warnings: string[] = [];
  const files: SqlFile[] = [];
  const batchSize = opts.dataBatchSize ?? 500;
  let rowCount = 0;

  const { rows: tables } = await client.query<{ schema_name: string; table_name: string }>(
    `SELECT n.nspname AS schema_name, c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname`,
  );

  const userTables = tables.filter((t) => !isExcludedTable(t.schema_name, t.table_name, opts));
  const parts: string[] = [];

  if (opts.includeHeaderComments) {
    parts.push("-- HHP Database Extractor — table data");
    parts.push(`-- Database: ${databaseName}`);
    parts.push("");
  }
  parts.push("SET session_replication_role = replica;");
  parts.push("");

  for (const t of userTables) {
    const qualified = qualifyTable(t.schema_name, t.table_name, "postgres");
    try {
      const { rows: colRows } = await client.query<{ column_name: string }>(
        `SELECT a.attname AS column_name
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [t.schema_name, t.table_name],
      );
      const colNames = colRows.map((c) => c.column_name);
      if (colNames.length === 0) continue;

      const tableSql: string[] = [`-- Data for ${qualified}`];
      let offset = 0;
      let tableRowsCount = 0;
      const orderCols = colNames.map((c) => quoteIdent(c, "postgres")).join(", ");
      for (;;) {
        const { rows } = await client.query<Record<string, unknown>>(
          `SELECT * FROM ${qualified} ORDER BY ${orderCols} OFFSET $1 LIMIT $2`,
          [offset, batchSize],
        );
        if (rows.length === 0) break;
        tableSql.push(...buildInsertBatches(qualified, colNames, rows, "postgres", batchSize));
        tableRowsCount += rows.length;
        offset += rows.length;
        if (rows.length < batchSize) break;
      }
      tableSql.push("");
      rowCount += tableRowsCount;
      const body = `${tableSql.join("\n")}\n`;
      parts.push(body);

      if (opts.splitPerObject) {
        files.push({
          filename: `objects/${CATEGORY_MAP.table_data.objectFolder}/${slug(t.schema_name)}.${slug(t.table_name)}.sql`,
          category: "table_data",
          content: body,
          sha256: "",
        });
      }
    } catch (err) {
      warnings.push(`Data dump failed for ${qualified}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  parts.push("SET session_replication_role = DEFAULT;");
  parts.push("");

  files.unshift({
    filename: CATEGORY_MAP.table_data.bulkFilename,
    category: "table_data",
    content: parts.join("\n"),
    sha256: "",
  });

  return { files, tableCount: userTables.length, rowCount, warnings };
}
