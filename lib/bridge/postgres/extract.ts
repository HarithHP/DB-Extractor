import type { Client } from "pg";
import { CATEGORY_MAP } from "@/lib/adapters/categories";
import type { AdapterExtractionOutput, SqlFile } from "@/lib/adapters/types";
import type { ConnectionConfig, ExtractionOptions, ObjectCategory } from "@/lib/schemas";
import { resolveExtractionOptions } from "@/lib/schemas";
import { slug } from "@/lib/utils/slug";
import { dumpPostgresTableData } from "./data";

export const MIN_SERVER_VERSION_NUM = 100000;

// Reserved words that quote_ident() would quote even when lower-case.
const RESERVED = new Set(
  ("all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation " +
    "column concurrently constraint create cross current_catalog current_date current_role current_schema current_time " +
    "current_timestamp current_user default deferrable desc distinct do else end except false fetch for foreign freeze " +
    "from full grant group having ilike in initially inner intersect into is isnull join lateral leading left like limit " +
    "localtime localtimestamp natural not notnull null offset on only or order outer overlaps placing primary references " +
    "returning right select session_user similar some symmetric system_user table tablesample then to trailing true union " +
    "unique user using variadic verbose when where window with").split(" "),
);
/** Mirrors PostgreSQL's quote_ident(): quote only when required. */
const qi = (ident: string) =>
  /^[a-z_][a-z0-9_$]*$/.test(ident) && !RESERVED.has(ident) ? ident : `"${ident.replaceAll('"', '""')}"`;
const qn = (schema: string, name: string) => `${qi(schema)}.${qi(name)}`;
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

function endStatement(sql: string): string {
  return `${sql.trim().replace(/;+\s*$/, "")};`;
}

interface Item {
  schema: string;
  name: string;
  /** Overrides the default `objects/<folder>/` location (used for user-defined types). */
  folder?: string;
  ddl: string;
}

interface TableRow {
  oid: number;
  schema: string;
  name: string;
  relkind: string;
  relpersistence: string;
  relispartition: boolean;
  partkey: string | null;
  partbound: string | null;
  parent: string | null;
  comment: string | null;
}

interface ColumnRow {
  table_oid: number;
  name: string;
  type: string;
  not_null: boolean;
  default_expr: string | null;
  identity: string;
  generated: string;
  collation: string | null;
  is_local: boolean;
  comment: string | null;
}

/** Shared WHERE fragment; $1 = excluded schema names (lowercase), $2 = exclude system schemas. */
const NSP_FILTER = `lower(n.nspname) <> ALL($1::text[])
  AND (NOT $2::boolean OR (n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'))`;

const notFromExtension = (catalog: string, oidExpr: string) =>
  `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = '${catalog}'::regclass AND d.objid = ${oidExpr} AND d.deptype = 'e')`;

export async function readServerInfo(client: Client) {
  const { rows } = await client.query<{ version: string; num: string; db: string; usr: string }>(
    "SELECT version() AS version, current_setting('server_version_num') AS num, current_database() AS db, current_user AS usr",
  );
  const r = rows[0];
  const short = /^PostgreSQL\s+([\d.]+\w*)/.exec(r.version)?.[1];
  return {
    versionNum: Number(r.num),
    serverVersion: short ? `PostgreSQL ${short}` : r.version,
    fullVersion: r.version,
    database: r.db,
    user: r.usr,
  };
}

export async function extractPostgres(
  client: Client,
  cfg: ConnectionConfig,
  rawOpts: ExtractionOptions,
): Promise<AdapterExtractionOutput> {
  const opts = resolveExtractionOptions(rawOpts);
  const info = await readServerInfo(client);
  if (info.versionNum < MIN_SERVER_VERSION_NUM) {
    throw Object.assign(new Error(`${info.fullVersion} is not supported; the extractor needs PostgreSQL 10 or newer.`), {
      code: "0A000",
    });
  }
  const v = info.versionNum;
  const params = [opts.excludedSchemas.map((s) => s.toLowerCase()).filter(Boolean), opts.excludeSystemSchemas];
  const files: SqlFile[] = [];
  const counts: Partial<Record<ObjectCategory, number>> = {};
  const warnings: string[] = [];
  const usedPaths = new Set<string>();

  const header = (category: ObjectCategory, extra: string[] = []) => {
    const lines: string[] = [];
    if (opts.includeHeaderComments) {
      lines.push("-- HHP Database Extractor");
      lines.push(`-- Engine: ${info.serverVersion} | Database: ${info.database} | Category: ${CATEGORY_MAP[category].label}`);
      lines.push(...extra);
    }
    if (opts.includeUseDatabaseHeader) {
      lines.push(`-- \\connect ${qi(info.database)}`);
      lines.push("SET client_encoding = 'UTF8';");
      if (cfg.schema?.trim()) lines.push(`SET search_path TO ${qi(cfg.schema.trim())}, public;`);
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

  const ine = opts.useIfNotExists ? "IF NOT EXISTS " : "";
  const withDrop = (drop: string, create: string) => (opts.dropFirst ? `${drop}\n${create}` : create);

  // ---- Schemas & extensions ----
  if (opts.includeSchemas) {
    const { rows } = await client.query<{ name: string; comment: string | null }>(
      `SELECT n.nspname AS name, obj_description(n.oid, 'pg_namespace') AS comment
         FROM pg_namespace n
        WHERE ${NSP_FILTER} AND ${notFromExtension("pg_namespace", "n.oid")}
        ORDER BY 1`,
      params,
    );
    emit(
      "schemas",
      rows.map((r) => {
        const create = `CREATE SCHEMA IF NOT EXISTS ${qi(r.name)};${r.comment ? `\nCOMMENT ON SCHEMA ${qi(r.name)} IS ${lit(r.comment)};` : ""}`;
        return {
          schema: r.name,
          name: r.name,
          ddl: r.name === "public" ? create : withDrop(`DROP SCHEMA IF EXISTS ${qi(r.name)} CASCADE;`, create),
        };
      }),
    );

    const ext = await client.query<{ name: string; version: string; schema: string }>(
      `SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
         FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname <> 'plpgsql'
        ORDER BY 1`,
    );
    emit(
      "extensions",
      ext.rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        ddl: `CREATE EXTENSION IF NOT EXISTS ${qi(r.name)} WITH SCHEMA ${qi(r.schema)}; -- version ${r.version}`,
      })),
    );
  }

  // ---- Sequences (identity-column sequences are recreated by their tables) ----
  if (opts.includeSequences) {
    const { rows } = await client.query<{
      schema: string;
      name: string;
      data_type: string;
      start_value: string;
      min_value: string;
      max_value: string;
      increment_by: string;
      cycle: boolean;
      cache_size: string;
      owned_by: string | null;
    }>(
      `SELECT s.schemaname AS schema, s.sequencename AS name, s.data_type::text AS data_type,
              s.start_value::text, s.min_value::text, s.max_value::text, s.increment_by::text,
              s.cycle, s.cache_size::text,
              (SELECT quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(a.attname)
                 FROM pg_depend d
                 JOIN pg_class tc ON tc.oid = d.refobjid
                 JOIN pg_namespace tn ON tn.oid = tc.relnamespace
                 JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'a' LIMIT 1) AS owned_by
         FROM pg_sequences s
         JOIN pg_namespace n ON n.nspname = s.schemaname
         JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = s.sequencename
        WHERE ${NSP_FILTER} AND ${notFromExtension("pg_class", "c.oid")}
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'i')
        ORDER BY 1, 2`,
      params,
    );
    emit(
      "sequences",
      rows.map((r) => {
        const name = qn(r.schema, r.name);
        const create = [
          `CREATE SEQUENCE ${ine}${name}`,
          `    AS ${r.data_type}`,
          `    INCREMENT BY ${r.increment_by}`,
          `    MINVALUE ${r.min_value}`,
          `    MAXVALUE ${r.max_value}`,
          `    START WITH ${r.start_value}`,
          `    CACHE ${r.cache_size}`,
          `    ${r.cycle ? "CYCLE" : "NO CYCLE"};`,
        ].join("\n");
        const owned = r.owned_by ? `\n-- Owned by ${r.owned_by} (run after 01_tables.sql: ALTER SEQUENCE ${name} OWNED BY ${r.owned_by};)` : "";
        return { schema: r.schema, name: r.name, ddl: withDrop(`DROP SEQUENCE IF EXISTS ${name} CASCADE;`, create) + owned };
      }),
    );
  }

  // ---- Tables (+ user-defined types they may depend on) ----
  const tables = (
    await client.query<TableRow>(
      `SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind,
              c.relpersistence::text AS relpersistence, c.relispartition,
              CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partkey,
              CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END AS partbound,
              (SELECT quote_ident(pn.nspname) || '.' || quote_ident(pc.relname)
                 FROM pg_inherits i JOIN pg_class pc ON pc.oid = i.inhparent JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                WHERE i.inhrelid = c.oid ORDER BY i.inhseqno LIMIT 1) AS parent,
              obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND ${NSP_FILTER} AND ${notFromExtension("pg_class", "c.oid")}
        ORDER BY c.relispartition, n.nspname, c.relname`,
      params,
    )
  ).rows;
  const tableOids = tables.map((t) => t.oid);
  const tableByOid = new Map(tables.map((t) => [t.oid, t]));

  const columns =
    tableOids.length === 0
      ? []
      : (
          await client.query<ColumnRow>(
            `SELECT a.attrelid::int AS table_oid, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
                    a.attnotnull AS not_null, pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
                    a.attidentity::text AS identity,
                    ${v >= 120000 ? "a.attgenerated::text" : "''"} AS generated,
                    CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation THEN
                      (SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
                         FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace WHERE co.oid = a.attcollation)
                    END AS collation,
                    a.attislocal AS is_local,
                    col_description(a.attrelid, a.attnum) AS comment
               FROM pg_attribute a
               JOIN pg_type t ON t.oid = a.atttypid
               LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
              WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attrelid, a.attnum`,
            [tableOids],
          )
        ).rows;
  const columnsByTable = new Map<number, ColumnRow[]>();
  for (const c of columns) {
    const list = columnsByTable.get(c.table_oid) ?? [];
    list.push(c);
    columnsByTable.set(c.table_oid, list);
  }

  const columnDef = (c: ColumnRow) => {
    const parts = [qi(c.name), c.type];
    if (c.collation) parts.push(`COLLATE ${c.collation}`);
    if (c.identity === "a") parts.push("GENERATED ALWAYS AS IDENTITY");
    else if (c.identity === "d") parts.push("GENERATED BY DEFAULT AS IDENTITY");
    else if (c.generated === "s" && c.default_expr) parts.push(`GENERATED ALWAYS AS (${c.default_expr}) STORED`);
    else if (c.generated === "v" && c.default_expr) parts.push(`GENERATED ALWAYS AS (${c.default_expr}) VIRTUAL`);
    else if (c.default_expr) parts.push(`DEFAULT ${c.default_expr}`);
    if (c.not_null) parts.push("NOT NULL");
    return parts.join(" ");
  };

  if (opts.includeTables) {
    const typeItems: Item[] = [];
    const { rows: types } = await client.query<{
      schema: string;
      name: string;
      typtype: string;
      base_type: string | null;
      typnotnull: boolean;
      typdefault: string | null;
      enum_labels: string | null;
      composite_cols: string | null;
      domain_checks: string | null;
      range_subtype: string | null;
    }>(
      `SELECT n.nspname AS schema, t.typname AS name, t.typtype::text AS typtype,
              CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END AS base_type,
              t.typnotnull, t.typdefault,
              (SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) AS enum_labels,
              (SELECT string_agg(quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                 FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) AS composite_cols,
              (SELECT string_agg('CONSTRAINT ' || quote_ident(c.conname) || ' ' || pg_get_constraintdef(c.oid), ' ' ORDER BY c.conname)
                 FROM pg_constraint c WHERE c.contypid = t.oid) AS domain_checks,
              (SELECT format_type(r.rngsubtype, NULL) FROM pg_range r WHERE r.rngtypid = t.oid) AS range_subtype
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         LEFT JOIN pg_class rc ON rc.oid = t.typrelid
        WHERE t.typtype IN ('e', 'd', 'c', 'r') AND (t.typtype <> 'c' OR rc.relkind = 'c')
          AND ${NSP_FILTER} AND ${notFromExtension("pg_type", "t.oid")}
        ORDER BY CASE t.typtype WHEN 'e' THEN 1 WHEN 'r' THEN 2 WHEN 'd' THEN 3 ELSE 4 END, n.nspname, t.typname`,
      params,
    );
    for (const t of types) {
      const name = qn(t.schema, t.name);
      let create: string;
      if (t.typtype === "e") create = `CREATE TYPE ${name} AS ENUM (${t.enum_labels ?? ""});`;
      else if (t.typtype === "r") create = `CREATE TYPE ${name} AS RANGE (SUBTYPE = ${t.range_subtype});`;
      else if (t.typtype === "c") create = `CREATE TYPE ${name} AS (${t.composite_cols ?? ""});`;
      else {
        create = `CREATE DOMAIN ${name} AS ${t.base_type}`;
        if (t.typdefault) create += ` DEFAULT ${t.typdefault}`;
        if (t.typnotnull) create += " NOT NULL";
        if (t.domain_checks) create += ` ${t.domain_checks}`;
        create += ";";
      }
      const drop = t.typtype === "d" ? `DROP DOMAIN IF EXISTS ${name} CASCADE;` : `DROP TYPE IF EXISTS ${name} CASCADE;`;
      typeItems.push({ schema: t.schema, name: t.name, folder: "types", ddl: withDrop(drop, create) });
    }

    const tableItems: Item[] = tables.map((t) => {
      const name = qn(t.schema, t.name);
      const cols = columnsByTable.get(t.oid) ?? [];
      let create: string;
      const kind = t.relpersistence === "u" ? "UNLOGGED TABLE" : "TABLE";
      if (t.relispartition && t.parent) {
        create = `CREATE ${kind} ${ine}${name} PARTITION OF ${t.parent}\n    ${t.partbound ?? "DEFAULT"}`;
      } else {
        const own = t.parent ? cols.filter((c) => c.is_local) : cols;
        create = `CREATE ${kind} ${ine}${name} (\n${own.map((c) => `    ${columnDef(c)}`).join(",\n")}\n)`;
        if (t.parent) create += ` INHERITS (${t.parent})`;
      }
      if (t.partkey) create += `\nPARTITION BY ${t.partkey}`;
      create += ";";
      const comments: string[] = [];
      if (t.comment) comments.push(`COMMENT ON TABLE ${name} IS ${lit(t.comment)};`);
      for (const c of cols) {
        if (c.comment) comments.push(`COMMENT ON COLUMN ${name}.${qi(c.name)} IS ${lit(c.comment)};`);
      }
      const ddl = withDrop(`DROP TABLE IF EXISTS ${name} CASCADE;`, create) + (comments.length ? `\n${comments.join("\n")}` : "");
      return { schema: t.schema, name: t.name, ddl };
    });

    const typeNote = typeItems.length > 0 ? [`-- Includes ${typeItems.length} user-defined type(s) ahead of the tables.`] : [];
    emit("tables", [...typeItems, ...tableItems], tableItems.length, [
      "-- Apply order: 13_schemas.sql, 15_extensions.sql, 11_sequences.sql, this file, then 03-06, 07, 08-10.",
      ...typeNote,
    ]);
  }

  if (opts.includeColumns) {
    emit(
      "columns",
      tables.map((t) => {
        const cols = columnsByTable.get(t.oid) ?? [];
        return {
          schema: t.schema,
          name: t.name,
          ddl: [`-- Table: ${qn(t.schema, t.name)} (${cols.length} columns)`, ...cols.map((c) => `--   ${columnDef(c)}`)].join("\n"),
        };
      }),
    );
  }

  // ---- Constraints ----
  if ((opts.includeKeys || opts.includeConstraints) && tableOids.length > 0) {
    const { rows } = await client.query<{ name: string; contype: string; table_oid: number; def: string }>(
      `SELECT con.conname AS name, con.contype::text AS contype, con.conrelid::int AS table_oid,
              pg_get_constraintdef(con.oid, true) AS def
         FROM pg_constraint con
        WHERE con.conrelid = ANY($1::oid[]) AND con.contype IN ('p', 'f', 'u', 'c', 'x') AND con.conislocal
          ${v >= 110000 ? "AND con.conparentid = 0" : ""}
        ORDER BY con.conrelid, con.conname`,
      [tableOids],
    );
    const toItem = (r: (typeof rows)[number]): Item => {
      const t = tableByOid.get(r.table_oid)!;
      const target = `${t.relkind === "p" ? "" : "ONLY "}${qn(t.schema, t.name)}`;
      return {
        schema: t.schema,
        name: `${t.name}.${r.name}`,
        ddl: withDrop(
          `ALTER TABLE ${target} DROP CONSTRAINT IF EXISTS ${qi(r.name)};`,
          `ALTER TABLE ${target}\n    ADD CONSTRAINT ${qi(r.name)} ${r.def};`,
        ),
      };
    };
    if (opts.includeKeys) {
      emit("primary_keys", rows.filter((r) => r.contype === "p").map(toItem));
      emit("foreign_keys", rows.filter((r) => r.contype === "f").map(toItem));
    }
    if (opts.includeConstraints) {
      emit("constraints", rows.filter((r) => ["u", "c", "x"].includes(r.contype)).map(toItem));
    }
  }

  // ---- Views & materialized views ----
  const views = (
    await client.query<{ oid: number; schema: string; name: string; relkind: string; def: string; comment: string | null }>(
      `SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind,
              pg_get_viewdef(c.oid, true) AS def, obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('v', 'm') AND ${NSP_FILTER} AND ${notFromExtension("pg_class", "c.oid")}
        ORDER BY c.oid`,
      params,
    )
  ).rows;

  if (opts.includeViews) {
    emit(
      "views",
      views.map((r) => {
        const name = qn(r.schema, r.name);
        const body = r.def.trim().replace(/;+\s*$/, "");
        const ddl =
          r.relkind === "m"
            ? withDrop(
                `DROP MATERIALIZED VIEW IF EXISTS ${name} CASCADE;`,
                `CREATE MATERIALIZED VIEW ${ine}${name} AS\n${body}\nWITH NO DATA;`,
              )
            : withDrop(`DROP VIEW IF EXISTS ${name} CASCADE;`, `CREATE OR REPLACE VIEW ${name} AS\n${body};`);
        const kindWord = r.relkind === "m" ? "MATERIALIZED VIEW" : "VIEW";
        return {
          schema: r.schema,
          name: r.name,
          ddl: ddl + (r.comment ? `\nCOMMENT ON ${kindWord} ${name} IS ${lit(r.comment)};` : ""),
        };
      }),
    );
  }

  // ---- Indexes (constraint-backed and partition-child indexes are skipped) ----
  const indexedOids = [...tableOids, ...views.filter((r) => r.relkind === "m").map((r) => r.oid)];
  if (opts.includeIndexes && indexedOids.length > 0) {
    const { rows } = await client.query<{ schema: string; name: string; table_name: string; def: string }>(
      `SELECT n.nspname AS schema, ic.relname AS name, tc.relname AS table_name, pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_class tc ON tc.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = ic.relnamespace
        WHERE i.indrelid = ANY($1::oid[])
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid AND c.contype IN ('p', 'u', 'x'))
          ${v >= 110000 ? "AND NOT ic.relispartition" : ""}
        ORDER BY n.nspname, tc.relname, ic.relname`,
      [indexedOids],
    );
    emit(
      "indexes",
      rows.map((r) => {
        const create = opts.useIfNotExists ? r.def.replace(/^CREATE (UNIQUE )?INDEX /, "CREATE $1INDEX IF NOT EXISTS ") : r.def;
        return {
          schema: r.schema,
          name: r.name,
          ddl: withDrop(`DROP INDEX IF EXISTS ${qn(r.schema, r.name)};`, endStatement(create)),
        };
      }),
    );
  }

  // ---- Functions & procedures ----
  if (opts.includeFunctions || opts.includeProcedures) {
    const kindExpr = v >= 110000 ? "p.prokind::text" : "CASE WHEN p.proisagg THEN 'a' WHEN p.proiswindow THEN 'w' ELSE 'f' END";
    const { rows } = await client.query<{ schema: string; name: string; kind: string; args: string; def: string }>(
      `SELECT n.nspname AS schema, p.proname AS name, ${kindExpr} AS kind,
              pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS def
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_language l ON l.oid = p.prolang
        WHERE ${NSP_FILTER} AND ${notFromExtension("pg_proc", "p.oid")}
          AND ${kindExpr} IN ('f', 'p') AND l.lanname NOT IN ('internal', 'c')
        ORDER BY n.nspname, p.proname, args`,
      params,
    );
    const toItem = (r: (typeof rows)[number], word: "FUNCTION" | "PROCEDURE"): Item => ({
      schema: r.schema,
      name: r.name,
      ddl: withDrop(`DROP ${word} IF EXISTS ${qn(r.schema, r.name)}(${r.args}) CASCADE;`, endStatement(r.def)),
    });
    if (opts.includeFunctions) emit("functions", rows.filter((r) => r.kind === "f").map((r) => toItem(r, "FUNCTION")));
    if (opts.includeProcedures) emit("procedures", rows.filter((r) => r.kind === "p").map((r) => toItem(r, "PROCEDURE")));
  }

  // ---- Triggers ----
  const triggerOids = [...tableOids, ...views.map((r) => r.oid)];
  if (opts.includeTriggers && triggerOids.length > 0) {
    const { rows } = await client.query<{ schema: string; table_name: string; name: string; def: string; is_constraint: boolean }>(
      `SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name,
              pg_get_triggerdef(t.oid, true) AS def, t.tgconstraint <> 0 AS is_constraint
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND t.tgrelid = ANY($1::oid[])
          ${v >= 130000 ? "AND t.tgparentid = 0" : ""}
        ORDER BY n.nspname, c.relname, t.tgname`,
      [triggerOids],
    );
    emit(
      "triggers",
      rows.map((r) => {
        const create =
          opts.useIfNotExists && v >= 140000 && !r.is_constraint
            ? r.def.replace(/^CREATE TRIGGER /, "CREATE OR REPLACE TRIGGER ")
            : r.def;
        return {
          schema: r.schema,
          name: `${r.table_name}.${r.name}`,
          ddl: withDrop(`DROP TRIGGER IF EXISTS ${qi(r.name)} ON ${qn(r.schema, r.table_name)};`, endStatement(create)),
        };
      }),
    );
  }

  // ---- Roles (attributes only; passwords are never exported) ----
  if (opts.includeRoles) {
    const { rows } = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolinherit: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolcanlogin: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
      rolconnlimit: number;
    }>(
      `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit
         FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY 1`,
    );
    emit(
      "roles",
      rows.map((r) => {
        const flags = [
          r.rolsuper ? "SUPERUSER" : "NOSUPERUSER",
          r.rolinherit ? "INHERIT" : "NOINHERIT",
          r.rolcreaterole ? "CREATEROLE" : "NOCREATEROLE",
          r.rolcreatedb ? "CREATEDB" : "NOCREATEDB",
          r.rolcanlogin ? "LOGIN" : "NOLOGIN",
          r.rolreplication ? "REPLICATION" : "NOREPLICATION",
          r.rolbypassrls ? "BYPASSRLS" : "NOBYPASSRLS",
        ];
        if (r.rolconnlimit >= 0) flags.push(`CONNECTION LIMIT ${r.rolconnlimit}`);
        return {
          schema: "cluster",
          name: r.rolname,
          ddl: `CREATE ROLE ${qi(r.rolname)} WITH ${flags.join(" ")}; -- password not exported`,
        };
      }),
    );
  }

  if (opts.includeSynonyms) counts.synonyms = 0;

  if (opts.includeTableData) {
    try {
      const data = await dumpPostgresTableData(client, opts, cfg.database);
      files.push(...data.files);
      counts.table_data = data.rowCount;
      warnings.push(...data.warnings);
      warnings.push(`Exported data for ${data.tableCount} table(s), ${data.rowCount} total row(s).`);
    } catch (err) {
      warnings.push(`Table data dump failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { files, counts, warnings, serverVersion: info.serverVersion };
}
