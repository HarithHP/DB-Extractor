import type { Connection } from "mysql2/promise";
import { CATEGORY_MAP } from "@/lib/adapters/categories";
import type { AdapterExtractionOutput, SqlFile } from "@/lib/adapters/types";
import type { ConnectionConfig, ExtractionOptions, ObjectCategory } from "@/lib/schemas";
import { resolveExtractionOptions } from "@/lib/schemas";
import { slug } from "@/lib/utils/slug";
import { dumpMysqlTableData } from "./data";

interface Item {
  schema: string;
  name: string;
  folder?: string;
  ddl: string;
}

export async function readServerInfo(conn: Connection) {
  const [rows] = (await conn.query(
    "SELECT VERSION() AS ver, DATABASE() AS db, CURRENT_USER() AS usr",
  )) as unknown as [{ ver: string; db: string; usr: string }[]];

  const r = rows[0] || { ver: "MySQL", db: "", usr: "" };
  const isMaria = /mariadb/i.test(r.ver);
  return {
    serverVersion: isMaria ? `MariaDB ${r.ver}` : `MySQL ${r.ver}`,
    fullVersion: r.ver,
    database: r.db || "",
    user: r.usr || "",
  };
}

const qi = (ident: string) => `\`${ident.replace(/`/g, "``")}\``;

function endStatement(sql: string): string {
  return `${sql.trim().replace(/;+\s*$/, "")};`;
}

export async function extractMysql(
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
      lines.push("SET NAMES utf8mb4;");
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

  const withDrop = (drop: string, create: string) => (opts.dropFirst ? `${drop}\n${create}` : create);

  // 1. Schemas / Databases
  if (opts.includeSchemas && targetDb) {
    const createDb = `CREATE DATABASE IF NOT EXISTS ${qi(targetDb)};`;
    emit("schemas", [
      {
        schema: targetDb,
        name: targetDb,
        ddl: withDrop(`DROP DATABASE IF EXISTS ${qi(targetDb)};`, createDb),
      },
    ]);
  }

  // 2. Tables & Columns
  if (opts.includeTables) {
    try {
      const [tableRows] = (await conn.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        [targetDb],
      )) as unknown as [{ TABLE_NAME: string }[]];

      const tableItems: Item[] = [];
      for (const row of tableRows) {
        const tName = row.TABLE_NAME;
        try {
          const [showRows] = (await conn.query(`SHOW CREATE TABLE ${qi(targetDb)}.${qi(tName)}`)) as unknown as [
            { [key: string]: string }[],
          ];
          if (showRows.length > 0) {
            let createSql = showRows[0]["Create Table"] || Object.values(showRows[0])[1] || "";
            if (opts.useIfNotExists && !/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(createSql)) {
              createSql = createSql.replace(/CREATE\s+TABLE/i, "CREATE TABLE IF NOT EXISTS");
            }
            createSql = endStatement(createSql);
            tableItems.push({
              schema: targetDb,
              name: tName,
              ddl: withDrop(`DROP TABLE IF EXISTS ${qi(tName)};`, createSql),
            });
          }
        } catch (tableErr) {
          warnings.push(`Could not read DDL for table ${tName}: ${tableErr instanceof Error ? tableErr.message : String(tableErr)}`);
        }
      }
      emit("tables", tableItems);
    } catch (err) {
      warnings.push(`Tables extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Columns (granular definitions)
  if (opts.includeColumns) {
    try {
      const [cols] = (await conn.query(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [targetDb],
      )) as unknown as [
        {
          TABLE_NAME: string;
          COLUMN_NAME: string;
          COLUMN_TYPE: string;
          IS_NULLABLE: string;
          COLUMN_DEFAULT: string | null;
          EXTRA: string;
          COLUMN_COMMENT: string;
        }[],
      ];

      const colItems: Item[] = cols.map((c) => {
        const nullClause = c.IS_NULLABLE === "NO" ? "NOT NULL" : "NULL";
        const defClause = c.COLUMN_DEFAULT !== null ? `DEFAULT '${c.COLUMN_DEFAULT}'` : "";
        const extraClause = c.EXTRA ? c.EXTRA.toUpperCase() : "";
        const commentClause = c.COLUMN_COMMENT ? `COMMENT '${c.COLUMN_COMMENT.replace(/'/g, "''")}'` : "";
        const definition = [qi(c.COLUMN_NAME), c.COLUMN_TYPE, nullClause, defClause, extraClause, commentClause]
          .filter(Boolean)
          .join(" ");

        return {
          schema: targetDb,
          name: `${c.TABLE_NAME}.${c.COLUMN_NAME}`,
          ddl: `-- Column ${qi(c.TABLE_NAME)}.${qi(c.COLUMN_NAME)}\nALTER TABLE ${qi(c.TABLE_NAME)} ADD COLUMN ${definition};`,
        };
      });
      emit("columns", colItems);
    } catch (err) {
      warnings.push(`Columns extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Primary Keys & Foreign Keys
  if (opts.includeKeys) {
    try {
      const [pks] = (await conn.query(
        `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME = 'PRIMARY'
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [targetDb],
      )) as unknown as [{ TABLE_NAME: string; COLUMN_NAME: string; ORDINAL_POSITION: number }[]];

      const pkByTable = new Map<string, string[]>();
      for (const r of pks) {
        const list = pkByTable.get(r.TABLE_NAME) ?? [];
        list.push(qi(r.COLUMN_NAME));
        pkByTable.set(r.TABLE_NAME, list);
      }

      const pkItems: Item[] = Array.from(pkByTable.entries()).map(([tbl, cols]) => ({
        schema: targetDb,
        name: `${tbl}_pk`,
        ddl: `ALTER TABLE ${qi(tbl)} ADD PRIMARY KEY (${cols.join(", ")});`,
      }));
      emit("primary_keys", pkItems);

      // Foreign Keys
      const [fks] = (await conn.query(
        `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.CONSTRAINT_NAME,
                kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
                rc.UPDATE_RULE, rc.DELETE_RULE
           FROM information_schema.KEY_COLUMN_USAGE kcu
           JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
             ON rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
            AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND rc.TABLE_NAME = kcu.TABLE_NAME
          WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
        [targetDb],
      )) as unknown as [
        {
          TABLE_NAME: string;
          COLUMN_NAME: string;
          CONSTRAINT_NAME: string;
          REFERENCED_TABLE_NAME: string;
          REFERENCED_COLUMN_NAME: string;
          UPDATE_RULE: string;
          DELETE_RULE: string;
        }[],
      ];

      const fkItems: Item[] = fks.map((fk) => ({
        schema: targetDb,
        name: `${fk.TABLE_NAME}.${fk.CONSTRAINT_NAME}`,
        ddl: `ALTER TABLE ${qi(fk.TABLE_NAME)} ADD CONSTRAINT ${qi(fk.CONSTRAINT_NAME)} FOREIGN KEY (${qi(fk.COLUMN_NAME)}) REFERENCES ${qi(fk.REFERENCED_TABLE_NAME)} (${qi(fk.REFERENCED_COLUMN_NAME)}) ON UPDATE ${fk.UPDATE_RULE} ON DELETE ${fk.DELETE_RULE};`,
      }));
      emit("foreign_keys", fkItems);
    } catch (err) {
      warnings.push(`Keys extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. Indexes
  if (opts.includeIndexes) {
    try {
      const [indexes] = (await conn.query(
        `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, INDEX_TYPE
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND INDEX_NAME <> 'PRIMARY'
          ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        [targetDb],
      )) as unknown as [
        {
          TABLE_NAME: string;
          INDEX_NAME: string;
          NON_UNIQUE: number;
          COLUMN_NAME: string;
          INDEX_TYPE: string;
        }[],
      ];

      const indexMap = new Map<string, { table: string; nonUnique: boolean; type: string; columns: string[] }>();
      for (const idx of indexes) {
        const key = `${idx.TABLE_NAME}.${idx.INDEX_NAME}`;
        const existing = indexMap.get(key) ?? {
          table: idx.TABLE_NAME,
          nonUnique: idx.NON_UNIQUE === 1,
          type: idx.INDEX_TYPE,
          columns: [],
        };
        existing.columns.push(qi(idx.COLUMN_NAME));
        indexMap.set(key, existing);
      }

      const indexItems: Item[] = Array.from(indexMap.entries()).map(([key, info]) => {
        const unique = !info.nonUnique ? "UNIQUE " : "";
        const idxName = key.split(".")[1];
        const createIdx = `CREATE ${unique}INDEX ${qi(idxName)} ON ${qi(info.table)} (${info.columns.join(", ")});`;
        return {
          schema: targetDb,
          name: key,
          ddl: withDrop(`DROP INDEX IF EXISTS ${qi(idxName)} ON ${qi(info.table)};`, createIdx),
        };
      });
      emit("indexes", indexItems);
    } catch (err) {
      warnings.push(`Indexes extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 6. Views
  if (opts.includeViews) {
    try {
      const [views] = (await conn.query(
        "SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
        [targetDb],
      )) as unknown as [{ TABLE_NAME: string }[]];

      const viewItems: Item[] = [];
      for (const v of views) {
        try {
          const [showRows] = (await conn.query(`SHOW CREATE VIEW ${qi(targetDb)}.${qi(v.TABLE_NAME)}`)) as unknown as [
            { [key: string]: string }[],
          ];
          if (showRows.length > 0) {
            let createSql = showRows[0]["Create View"] || Object.values(showRows[0])[1] || "";
            createSql = endStatement(createSql);
            viewItems.push({
              schema: targetDb,
              name: v.TABLE_NAME,
              ddl: withDrop(`DROP VIEW IF EXISTS ${qi(v.TABLE_NAME)};`, createSql),
            });
          }
        } catch (vErr) {
          warnings.push(`Could not read DDL for view ${v.TABLE_NAME}: ${vErr instanceof Error ? vErr.message : String(vErr)}`);
        }
      }
      emit("views", viewItems);
    } catch (err) {
      warnings.push(`Views extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 7. Stored Procedures & Functions
  if (opts.includeProcedures || opts.includeFunctions) {
    try {
      const [routines] = (await conn.query(
        "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME",
        [targetDb],
      )) as unknown as [{ ROUTINE_NAME: string; ROUTINE_TYPE: "PROCEDURE" | "FUNCTION" }[]];

      const procItems: Item[] = [];
      const funcItems: Item[] = [];

      for (const r of routines) {
        try {
          const type = r.ROUTINE_TYPE;
          const [showRows] = (await conn.query(
            `SHOW CREATE ${type} ${qi(targetDb)}.${qi(r.ROUTINE_NAME)}`,
          )) as unknown as [{ [key: string]: string }[]];

          if (showRows.length > 0) {
            const rawSql =
              showRows[0][`Create ${type.charAt(0) + type.slice(1).toLowerCase()}`] ||
              showRows[0]["Create Procedure"] ||
              showRows[0]["Create Function"] ||
              Object.values(showRows[0])[2] ||
              "";

            const createSql = endStatement(rawSql);
            const dropSql = `DROP ${type} IF EXISTS ${qi(r.ROUTINE_NAME)};`;
            const item: Item = {
              schema: targetDb,
              name: r.ROUTINE_NAME,
              ddl: withDrop(dropSql, createSql),
            };

            if (type === "PROCEDURE" && opts.includeProcedures) procItems.push(item);
            if (type === "FUNCTION" && opts.includeFunctions) funcItems.push(item);
          }
        } catch (rErr) {
          warnings.push(`Could not read ${r.ROUTINE_TYPE} ${r.ROUTINE_NAME}: ${rErr instanceof Error ? rErr.message : String(rErr)}`);
        }
      }

      if (opts.includeProcedures) emit("procedures", procItems);
      if (opts.includeFunctions) emit("functions", funcItems);
    } catch (err) {
      warnings.push(`Routines extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 8. Triggers
  if (opts.includeTriggers) {
    try {
      const [triggers] = (await conn.query(
        "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME",
        [targetDb],
      )) as unknown as [{ TRIGGER_NAME: string }[]];

      const triggerItems: Item[] = [];
      for (const trg of triggers) {
        try {
          const [showRows] = (await conn.query(
            `SHOW CREATE TRIGGER ${qi(targetDb)}.${qi(trg.TRIGGER_NAME)}`,
          )) as unknown as [{ [key: string]: string }[]];

          if (showRows.length > 0) {
            const createSql = endStatement(showRows[0]["SQL Original Statement"] || Object.values(showRows[0])[2] || "");
            triggerItems.push({
              schema: targetDb,
              name: trg.TRIGGER_NAME,
              ddl: withDrop(`DROP TRIGGER IF EXISTS ${qi(trg.TRIGGER_NAME)};`, createSql),
            });
          }
        } catch (trgErr) {
          warnings.push(`Could not read trigger ${trg.TRIGGER_NAME}: ${trgErr instanceof Error ? trgErr.message : String(trgErr)}`);
        }
      }
      emit("triggers", triggerItems);
    } catch (err) {
      warnings.push(`Triggers extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (opts.includeTableData) {
    try {
      const data = await dumpMysqlTableData(conn, opts, targetDb);
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
