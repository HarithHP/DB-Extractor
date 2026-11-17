import type { Connection } from "tedious";
import { CATEGORY_MAP } from "@/lib/adapters/categories";
import type { SqlFile } from "@/lib/adapters/types";
import type { ExtractionOptions } from "@/lib/schemas";
import { buildInsertBatches, qualifyTable, quoteIdent } from "@/lib/bridge/sql-literals";
import { isExcludedTable } from "@/lib/bridge/schema-filter";
import { slug } from "@/lib/utils/slug";
import { executeMssqlQuery } from "./client";

export interface TableDataDumpResult {
  files: SqlFile[];
  tableCount: number;
  rowCount: number;
  warnings: string[];
}

export async function dumpMssqlTableData(
  conn: Connection,
  opts: ExtractionOptions,
  databaseName: string,
): Promise<TableDataDumpResult> {
  const warnings: string[] = [];
  const files: SqlFile[] = [];
  const batchSize = opts.dataBatchSize ?? 500;
  let rowCount = 0;

  const tables = await executeMssqlQuery<{ schema_name: string; table_name: string }>(
    conn,
    `SELECT s.name AS schema_name, t.name AS table_name
       FROM sys.tables t
       JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.is_ms_shipped = 0
      ORDER BY s.name, t.name`,
  );

  const userTables = tables.filter((t) => !isExcludedTable(t.schema_name, t.table_name, opts));
  const parts: string[] = [];

  if (opts.includeHeaderComments) {
    parts.push("-- HHP Database Extractor — table data");
    parts.push(`-- Database: ${databaseName}`);
    parts.push("");
  }
  if (opts.includeUseDatabaseHeader && databaseName) {
    parts.push(`USE ${quoteIdent(databaseName, "mssql")};`);
    parts.push("GO");
    parts.push("");
  }
  parts.push("SET NOCOUNT ON;");
  parts.push("");

  for (const t of userTables) {
    const qualified = qualifyTable(t.schema_name, t.table_name, "mssql");
    try {
      const cols = await executeMssqlQuery<{ column_name: string; is_identity: boolean }>(
        conn,
        `SELECT c.name AS column_name, c.is_identity
           FROM sys.columns c
           JOIN sys.tables tb ON tb.object_id = c.object_id
           JOIN sys.schemas s ON s.schema_id = tb.schema_id
          WHERE s.name = N'${t.schema_name.replace(/'/g, "''")}'
            AND tb.name = N'${t.table_name.replace(/'/g, "''")}'
          ORDER BY c.column_id`,
      );
      const colNames = cols.map((c) => c.column_name);
      if (colNames.length === 0) continue;

      const hasIdentity = cols.some((c) => c.is_identity);
      const tableSql: string[] = [];
      tableSql.push(`-- Data for ${qualified}`);
      if (hasIdentity) tableSql.push(`SET IDENTITY_INSERT ${qualified} ON;`);

      let offset = 0;
      let tableRows = 0;
      for (;;) {
        const orderCols = colNames.map((c) => quoteIdent(c, "mssql")).join(", ");
        const selectList = colNames.map((c) => quoteIdent(c, "mssql")).join(", ");
        const rows = await executeMssqlQuery<Record<string, unknown>>(
          conn,
          `SELECT ${selectList}
             FROM ${qualified}
            ORDER BY ${orderCols}
            OFFSET ${offset} ROWS FETCH NEXT ${batchSize} ROWS ONLY`,
        );
        if (rows.length === 0) break;
        tableSql.push(...buildInsertBatches(qualified, colNames, rows, "mssql", batchSize));
        tableRows += rows.length;
        offset += rows.length;
        if (rows.length < batchSize) break;
      }

      if (hasIdentity) tableSql.push(`SET IDENTITY_INSERT ${qualified} OFF;`);
      tableSql.push("");

      rowCount += tableRows;
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
      warnings.push(
        `Data dump failed for ${qualified}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  files.unshift({
    filename: CATEGORY_MAP.table_data.bulkFilename,
    category: "table_data",
    content: parts.join("\n"),
    sha256: "",
  });

  return { files, tableCount: userTables.length, rowCount, warnings };
}
