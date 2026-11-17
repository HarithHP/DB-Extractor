import type { Connection } from "tedious";
import { CATEGORY_MAP } from "@/lib/adapters/categories";
import type { AdapterExtractionOutput, SqlFile } from "@/lib/adapters/types";
import type { ConnectionConfig, ExtractionOptions, ObjectCategory } from "@/lib/schemas";
import { resolveExtractionOptions } from "@/lib/schemas";
import { slug } from "@/lib/utils/slug";
import { executeMssqlQuery } from "./client";
import { dumpMssqlTableData } from "./data";

interface Item {
  schema: string;
  name: string;
  folder?: string;
  ddl: string;
}

const qi = (ident: string) => `[${ident.replace(/]/g, "]]")}]`;
const qn = (schema: string, name: string) => `${qi(schema)}.${qi(name)}`;

function endStatement(sql: string): string {
  return `${sql.trim().replace(/;+\s*$/, "")};`;
}

export async function readServerInfo(conn: Connection) {
  const rows = await executeMssqlQuery<{ ver: string; db: string; usr: string }>(
    conn,
    "SELECT @@VERSION AS ver, DB_NAME() AS db, SUSER_SNAME() AS usr;",
  );
  const r = rows[0] || { ver: "Microsoft SQL Server", db: "", usr: "" };
  const firstLine = r.ver.split("\n")[0].trim();
  return {
    serverVersion: firstLine || "Microsoft SQL Server",
    fullVersion: r.ver,
    database: r.db || "",
    user: r.usr || "",
  };
}

export async function extractMssql(
  conn: Connection,
  cfg: ConnectionConfig,
  rawOpts: ExtractionOptions,
): Promise<AdapterExtractionOutput> {
  const opts = resolveExtractionOptions(rawOpts);
  const info = await readServerInfo(conn);
  const targetDb = cfg.database?.trim() || info.database;
  const files: SqlFile[] = [];
  const counts: Partial<Record<ObjectCategory, number>> = {};
  const warnings: string[] = [];
  const usedPaths = new Set<string>();

  const header = (category: ObjectCategory, extra: string[] = []) => {
    const lines: string[] = [];
    if (opts.includeHeaderComments) {
      lines.push("-- HHP Database Extractor");
      lines.push(
        `-- Engine: ${info.serverVersion} | Database: ${targetDb} | Category: ${CATEGORY_MAP[category].label}`,
      );
      lines.push(...extra);
    }
    if (opts.includeUseDatabaseHeader && targetDb) {
      lines.push(`USE ${qi(targetDb)};`);
      lines.push("GO");
    }
    return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
  };

  const objectPath = (folder: string, schema: string, name: string) => {
    const base = `objects/${folder}/${slug(schema)}.${slug(name)}`;
    let path = `${base}.sql`;
    for (let i = 2; usedPaths.has(path); i++) path = `${base}_${i}.sql`;
    usedPaths.add(path);
    return path;
  };

  const emit = (category: ObjectCategory, items: Item[], count = items.length, headerExtra: string[] = []) => {
    counts[category] = count;
    if (items.length === 0) return;
    const head = header(category, headerExtra);
    files.push({
      filename: CATEGORY_MAP[category].bulkFilename,
      category,
      content: `${head}${items.map((i) => i.ddl).join("\n\n")}\n`,
      sha256: "",
    });
    if (opts.splitPerObject) {
      for (const item of items) {
        files.push({
          filename: objectPath(item.folder ?? CATEGORY_MAP[category].objectFolder, item.schema, item.name),
          category,
          content: `${head}${item.ddl}\n`,
          sha256: "",
        });
      }
    }
  };

  const withDrop = (drop: string, create: string) => (opts.dropFirst ? `${drop}\nGO\n${create}` : create);

  // 1. Schemas
  if (opts.includeSchemas) {
    try {
      const schemas = await executeMssqlQuery<{ name: string }>(
        conn,
        `SELECT name FROM sys.schemas
          WHERE name NOT IN ('sys', 'information_schema', 'guest')
            AND name NOT LIKE 'db_%'
          ORDER BY name`,
      );
      const schemaItems: Item[] = schemas.map((s) => ({
        schema: s.name,
        name: s.name,
        ddl: `IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'${s.name.replace(/'/g, "''")}')\n  EXEC('CREATE SCHEMA ${qi(s.name)}');`,
      }));
      emit("schemas", schemaItems);
    } catch (err) {
      warnings.push(`Schemas extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Tables & Columns
  if (opts.includeTables) {
    try {
      const tables = await executeMssqlQuery<{ schema_name: string; table_name: string; object_id: number }>(
        conn,
        `SELECT s.name AS schema_name, t.name AS table_name, t.object_id
           FROM sys.tables t
           JOIN sys.schemas s ON s.schema_id = t.schema_id
          WHERE t.is_ms_shipped = 0
          ORDER BY s.name, t.name`,
      );

      const tableItems: Item[] = [];
      const colItems: Item[] = [];

      for (const t of tables) {
        try {
          const cols = await executeMssqlQuery<{
            column_name: string;
            data_type: string;
            max_length: number;
            precision: number;
            scale: number;
            is_nullable: boolean;
            is_identity: boolean;
            seed_value: number | null;
            increment_value: number | null;
            default_definition: string | null;
          }>(
            conn,
            `SELECT 
               c.name AS column_name,
               tp.name AS data_type,
               c.max_length,
               c.precision,
               c.scale,
               c.is_nullable,
               c.is_identity,
               CAST(ic.seed_value AS bigint) AS seed_value,
               CAST(ic.increment_value AS bigint) AS increment_value,
               dc.definition AS default_definition
             FROM sys.columns c
             JOIN sys.types tp ON tp.user_type_id = c.user_type_id
             LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
             LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
            WHERE c.object_id = ${t.object_id}
            ORDER BY c.column_id`,
          );

          const colDefs: string[] = [];
          for (const col of cols) {
            let typeStr = col.data_type.toUpperCase();
            if (["VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "BINARY", "VARBINARY"].includes(typeStr)) {
              typeStr += col.max_length === -1 ? "(MAX)" : `(${typeStr.startsWith("N") ? col.max_length / 2 : col.max_length})`;
            } else if (["DECIMAL", "NUMERIC"].includes(typeStr)) {
              typeStr += `(${col.precision}, ${col.scale})`;
            }

            const identity = col.is_identity ? ` IDENTITY(${col.seed_value ?? 1},${col.increment_value ?? 1})` : "";
            const defConstraint = col.default_definition ? ` DEFAULT ${col.default_definition}` : "";
            const nullStr = col.is_nullable ? "NULL" : "NOT NULL";
            const line = `  ${qi(col.column_name)} ${typeStr}${identity}${defConstraint} ${nullStr}`;
            colDefs.push(line);

            if (opts.includeColumns) {
              colItems.push({
                schema: t.schema_name,
                name: `${t.table_name}.${col.column_name}`,
                ddl: `ALTER TABLE ${qn(t.schema_name, t.table_name)} ADD ${qi(col.column_name)} ${typeStr}${identity}${defConstraint} ${nullStr};`,
              });
            }
          }

          const fullName = qn(t.schema_name, t.table_name);
          const createTable = `CREATE TABLE ${fullName} (\n${colDefs.join(",\n")}\n);`;
          const guard = opts.useIfNotExists
            ? `IF NOT EXISTS (SELECT * FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = N'${t.schema_name}' AND t.name = N'${t.table_name}')\n`
            : "";
          const dropTable = `IF OBJECT_ID(N'${t.schema_name}.${t.table_name}', N'U') IS NOT NULL DROP TABLE ${fullName};`;

          tableItems.push({
            schema: t.schema_name,
            name: t.table_name,
            ddl: withDrop(dropTable, `${guard}${createTable}`),
          });
        } catch (tErr) {
          warnings.push(`Could not read columns for table ${t.schema_name}.${t.table_name}: ${tErr instanceof Error ? tErr.message : String(tErr)}`);
        }
      }

      emit("tables", tableItems);
      if (opts.includeColumns) emit("columns", colItems);
    } catch (err) {
      warnings.push(`Tables extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Primary Keys & Foreign Keys
  if (opts.includeKeys) {
    try {
      const pks = await executeMssqlQuery<{
        schema_name: string;
        table_name: string;
        pk_name: string;
        col_name: string;
        key_ordinal: number;
      }>(
        conn,
        `SELECT 
           s.name AS schema_name,
           t.name AS table_name,
           k.name AS pk_name,
           c.name AS col_name,
           ic.key_ordinal
         FROM sys.key_constraints k
         JOIN sys.tables t ON t.object_id = k.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = k.unique_index_id
         JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
        WHERE k.type = 'PK' AND t.is_ms_shipped = 0
        ORDER BY s.name, t.name, k.name, ic.key_ordinal`,
      );

      const pkMap = new Map<string, { schema: string; table: string; pkName: string; cols: string[] }>();
      for (const r of pks) {
        const key = `${r.schema_name}.${r.table_name}.${r.pk_name}`;
        const existing = pkMap.get(key) ?? { schema: r.schema_name, table: r.table_name, pkName: r.pk_name, cols: [] };
        existing.cols.push(qi(r.col_name));
        pkMap.set(key, existing);
      }

      const pkItems: Item[] = Array.from(pkMap.values()).map((p) => ({
        schema: p.schema,
        name: p.pkName,
        ddl: `ALTER TABLE ${qn(p.schema, p.table)} ADD CONSTRAINT ${qi(p.pkName)} PRIMARY KEY (${p.cols.join(", ")});`,
      }));
      emit("primary_keys", pkItems);

      // Foreign Keys
      const fks = await executeMssqlQuery<{
        schema_name: string;
        table_name: string;
        fk_name: string;
        col_name: string;
        ref_schema_name: string;
        ref_table_name: string;
        ref_col_name: string;
        update_action: string;
        delete_action: string;
      }>(
        conn,
        `SELECT 
           s.name AS schema_name,
           t.name AS table_name,
           fk.name AS fk_name,
           c.name AS col_name,
           rs.name AS ref_schema_name,
           rt.name AS ref_table_name,
           rc.name AS ref_col_name,
           fk.update_referential_action_desc AS update_action,
           fk.delete_referential_action_desc AS delete_action
         FROM sys.foreign_keys fk
         JOIN sys.tables t ON t.object_id = fk.parent_object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = fkc.parent_column_id
         JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
         JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
         JOIN sys.columns rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id
        WHERE t.is_ms_shipped = 0
        ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id`,
      );

      const fkMap = new Map<
        string,
        {
          schema: string;
          table: string;
          fkName: string;
          cols: string[];
          refSchema: string;
          refTable: string;
          refCols: string[];
          onUpdate: string;
          onDelete: string;
        }
      >();

      for (const r of fks) {
        const key = `${r.schema_name}.${r.table_name}.${r.fk_name}`;
        const existing = fkMap.get(key) ?? {
          schema: r.schema_name,
          table: r.table_name,
          fkName: r.fk_name,
          cols: [],
          refSchema: r.ref_schema_name,
          refTable: r.ref_table_name,
          refCols: [],
          onUpdate: r.update_action.replace(/_/g, " "),
          onDelete: r.delete_action.replace(/_/g, " "),
        };
        existing.cols.push(qi(r.col_name));
        existing.refCols.push(qi(r.ref_col_name));
        fkMap.set(key, existing);
      }

      const fkItems: Item[] = Array.from(fkMap.values()).map((f) => ({
        schema: f.schema,
        name: f.fkName,
        ddl: `ALTER TABLE ${qn(f.schema, f.table)} ADD CONSTRAINT ${qi(f.fkName)} FOREIGN KEY (${f.cols.join(", ")}) REFERENCES ${qn(f.refSchema, f.refTable)} (${f.refCols.join(", ")}) ON UPDATE ${f.onUpdate} ON DELETE ${f.onDelete};`,
      }));
      emit("foreign_keys", fkItems);
    } catch (err) {
      warnings.push(`Keys extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Indexes
  if (opts.includeIndexes) {
    try {
      const indexes = await executeMssqlQuery<{
        schema_name: string;
        table_name: string;
        index_name: string;
        is_unique: boolean;
        type_desc: string;
        col_name: string;
        is_descending_key: boolean;
      }>(
        conn,
        `SELECT 
           s.name AS schema_name,
           t.name AS table_name,
           i.name AS index_name,
           i.is_unique,
           i.type_desc,
           c.name AS col_name,
           ic.is_descending_key
         FROM sys.indexes i
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
        WHERE i.is_primary_key = 0
          AND i.is_unique_constraint = 0
          AND i.type > 0
          AND t.is_ms_shipped = 0
        ORDER BY s.name, t.name, i.name, ic.key_ordinal`,
      );

      const idxMap = new Map<
        string,
        { schema: string; table: string; indexName: string; isUnique: boolean; cols: string[] }
      >();

      for (const r of indexes) {
        const key = `${r.schema_name}.${r.table_name}.${r.index_name}`;
        const existing = idxMap.get(key) ?? {
          schema: r.schema_name,
          table: r.table_name,
          indexName: r.index_name,
          isUnique: r.is_unique,
          cols: [],
        };
        existing.cols.push(`${qi(r.col_name)}${r.is_descending_key ? " DESC" : " ASC"}`);
        idxMap.set(key, existing);
      }

      const idxItems: Item[] = Array.from(idxMap.values()).map((idx) => {
        const unique = idx.isUnique ? "UNIQUE " : "";
        const createSql = `CREATE ${unique}NONCLUSTERED INDEX ${qi(idx.indexName)} ON ${qn(idx.schema, idx.table)} (${idx.cols.join(", ")});`;
        const dropSql = `IF EXISTS (SELECT * FROM sys.indexes WHERE name = N'${idx.indexName}' AND object_id = OBJECT_ID(N'${idx.schema}.${idx.table}')) DROP INDEX ${qi(idx.indexName)} ON ${qn(idx.schema, idx.table)};`;
        return {
          schema: idx.schema,
          name: idx.indexName,
          ddl: withDrop(dropSql, createSql),
        };
      });
      emit("indexes", idxItems);
    } catch (err) {
      warnings.push(`Indexes extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. Views
  if (opts.includeViews) {
    try {
      const views = await executeMssqlQuery<{ schema_name: string; view_name: string; definition: string }>(
        conn,
        `SELECT s.name AS schema_name, v.name AS view_name, OBJECT_DEFINITION(v.object_id) AS definition
           FROM sys.views v
           JOIN sys.schemas s ON s.schema_id = v.schema_id
          WHERE v.is_ms_shipped = 0
          ORDER BY s.name, v.name`,
      );

      const viewItems: Item[] = views
        .filter((v) => Boolean(v.definition))
        .map((v) => {
          const dropSql = `IF OBJECT_ID(N'${v.schema_name}.${v.view_name}', N'V') IS NOT NULL DROP VIEW ${qn(v.schema_name, v.view_name)};`;
          return {
            schema: v.schema_name,
            name: v.view_name,
            ddl: withDrop(dropSql, endStatement(v.definition)),
          };
        });
      emit("views", viewItems);
    } catch (err) {
      warnings.push(`Views extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 6. Stored Procedures & Functions
  if (opts.includeProcedures) {
    try {
      const procs = await executeMssqlQuery<{ schema_name: string; proc_name: string; definition: string }>(
        conn,
        `SELECT s.name AS schema_name, p.name AS proc_name, OBJECT_DEFINITION(p.object_id) AS definition
           FROM sys.procedures p
           JOIN sys.schemas s ON s.schema_id = p.schema_id
          WHERE p.is_ms_shipped = 0
          ORDER BY s.name, p.name`,
      );

      const procItems: Item[] = procs
        .filter((p) => Boolean(p.definition))
        .map((p) => {
          const dropSql = `IF OBJECT_ID(N'${p.schema_name}.${p.proc_name}', N'P') IS NOT NULL DROP PROCEDURE ${qn(p.schema_name, p.proc_name)};`;
          return {
            schema: p.schema_name,
            name: p.proc_name,
            ddl: withDrop(dropSql, endStatement(p.definition)),
          };
        });
      emit("procedures", procItems);
    } catch (err) {
      warnings.push(`Procedures extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (opts.includeFunctions) {
    try {
      const funcs = await executeMssqlQuery<{ schema_name: string; func_name: string; definition: string }>(
        conn,
        `SELECT s.name AS schema_name, o.name AS func_name, OBJECT_DEFINITION(o.object_id) AS definition
           FROM sys.objects o
           JOIN sys.schemas s ON s.schema_id = o.schema_id
          WHERE o.type IN ('FN', 'IF', 'TF') AND o.is_ms_shipped = 0
          ORDER BY s.name, o.name`,
      );

      const funcItems: Item[] = funcs
        .filter((f) => Boolean(f.definition))
        .map((f) => {
          const dropSql = `IF OBJECT_ID(N'${f.schema_name}.${f.func_name}', N'FN') IS NOT NULL OR OBJECT_ID(N'${f.schema_name}.${f.func_name}', N'IF') IS NOT NULL OR OBJECT_ID(N'${f.schema_name}.${f.func_name}', N'TF') IS NOT NULL DROP FUNCTION ${qn(f.schema_name, f.func_name)};`;
          return {
            schema: f.schema_name,
            name: f.func_name,
            ddl: withDrop(dropSql, endStatement(f.definition)),
          };
        });
      emit("functions", funcItems);
    } catch (err) {
      warnings.push(`Functions extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 7. Triggers
  if (opts.includeTriggers) {
    try {
      const triggers = await executeMssqlQuery<{ schema_name: string; trigger_name: string; definition: string }>(
        conn,
        `SELECT s.name AS schema_name, tr.name AS trigger_name, OBJECT_DEFINITION(tr.object_id) AS definition
           FROM sys.triggers tr
           JOIN sys.tables t ON t.object_id = tr.parent_id
           JOIN sys.schemas s ON s.schema_id = t.schema_id
          WHERE tr.is_ms_shipped = 0
          ORDER BY s.name, tr.name`,
      );

      const trgItems: Item[] = triggers
        .filter((tr) => Boolean(tr.definition))
        .map((tr) => {
          const dropSql = `IF OBJECT_ID(N'${tr.schema_name}.${tr.trigger_name}', N'TR') IS NOT NULL DROP TRIGGER ${qn(tr.schema_name, tr.trigger_name)};`;
          return {
            schema: tr.schema_name,
            name: tr.trigger_name,
            ddl: withDrop(dropSql, endStatement(tr.definition)),
          };
        });
      emit("triggers", trgItems);
    } catch (err) {
      warnings.push(`Triggers extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (opts.includeTableData) {
    try {
      const data = await dumpMssqlTableData(conn, opts, targetDb);
      files.push(...data.files);
      counts.table_data = data.rowCount;
      warnings.push(...data.warnings);
      warnings.push(`Exported data for ${data.tableCount} table(s), ${data.rowCount} total row(s).`);
    } catch (err) {
      warnings.push(`Table data dump failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    files,
    counts,
    warnings,
    serverVersion: info.serverVersion,
  };
}
