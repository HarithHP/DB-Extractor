import type { Connection } from "mysql2/promise";
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

export async function dumpMysqlTableData(
  conn: Connection,
  opts: ExtractionOptions,
  databaseName: string,
): Promise<TableDataDumpResult> {
  const warnings: string[] = [];
  const files: SqlFile[] = [];
  const batchSize = opts.dataBatchSize ?? 500;
  let rowCount = 0;

  const [tableRows] = (await conn.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    [databaseName],
  )) as unknown as [{ TABLE_NAME: string }[]];

  const userTables = tableRows
    .map((r) => r.TABLE_NAME)
    .filter((name) => !isExcludedTable(databaseName, name, opts));

  const parts: string[] = [];
  if (opts.includeHeaderComments) {
    parts.push("-- HHP Database Extractor — table data");
    parts.push(`-- Database: ${databaseName}`);
    parts.push("");
  }
  if (opts.includeUseDatabaseHeader && databaseName) {
    parts.push(`USE ${quoteIdent(databaseName, "mysql")};`);
    parts.push("");
  }
  parts.push("SET FOREIGN_KEY_CHECKS=0;");
  parts.push("SET UNIQUE_CHECKS=0;");
  parts.push("");

  for (const table of userTables) {
    const qualified = qualifyTable(databaseName, table, "mysql");
    try {
      const [colRows] = (await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
        [databaseName, table],
      )) as unknown as [{ COLUMN_NAME: string }[]];
      const colNames = colRows.map((c) => c.COLUMN_NAME);
      if (colNames.length === 0) continue;

      const tableSql: string[] = [`-- Data for ${qualified}`];
      let offset = 0;
      let tableRowsCount = 0;
      for (;;) {
        const [rows] = (await conn.query(
          `SELECT * FROM ${qualified} LIMIT ${batchSize} OFFSET ${offset}`,
        )) as unknown as [Record<string, unknown>[]];
        if (rows.length === 0) break;
        tableSql.push(...buildInsertBatches(qualified, colNames, rows, "mysql", batchSize));
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
          filename: `objects/${CATEGORY_MAP.table_data.objectFolder}/${slug(databaseName)}.${slug(table)}.sql`,
          category: "table_data",
          content: body,
          sha256: "",
        });
      }
    } catch (err) {
      warnings.push(`Data dump failed for ${qualified}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  parts.push("SET UNIQUE_CHECKS=1;");
  parts.push("SET FOREIGN_KEY_CHECKS=1;");
  parts.push("");

  files.unshift({
    filename: CATEGORY_MAP.table_data.bulkFilename,
    category: "table_data",
    content: parts.join("\n"),
    sha256: "",
  });

  return { files, tableCount: userTables.length, rowCount, warnings };
}
