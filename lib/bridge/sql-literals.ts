/** Portable SQL literal helpers for INSERT dumps. */

export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlByteaHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

export function sqlLiteral(value: unknown, dialect: "postgres" | "mysql" | "mssql" | "sqlite"): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") {
    if (dialect === "postgres") return value ? "TRUE" : "FALSE";
    return value ? "1" : "0";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (dialect === "mssql") return sqlStringLiteral(iso.slice(0, 23).replace("T", " "));
    return sqlStringLiteral(iso);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return formatBinary(new Uint8Array(value), dialect);
  }
  if (value instanceof Uint8Array) {
    return formatBinary(value, dialect);
  }
  if (typeof value === "object") {
    return sqlStringLiteral(JSON.stringify(value));
  }
  return sqlStringLiteral(String(value));
}

function formatBinary(bytes: Uint8Array, dialect: "postgres" | "mysql" | "mssql" | "sqlite"): string {
  if (bytes.length === 0) {
    if (dialect === "postgres") return `'\\x'::bytea`;
    if (dialect === "mssql") return `0x`;
    return `X''`;
  }
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  if (dialect === "postgres") return `'\\x${hex}'::bytea`;
  if (dialect === "mssql") return `0x${hex}`;
  return `X'${hex}'`;
}

export function quoteIdent(name: string, dialect: "postgres" | "mysql" | "mssql" | "sqlite"): string {
  if (dialect === "mssql") return `[${name.replace(/]/g, "]]")}]`;
  if (dialect === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualifyTable(
  schema: string | undefined,
  table: string,
  dialect: "postgres" | "mysql" | "mssql" | "sqlite",
): string {
  if (!schema || dialect === "sqlite") return quoteIdent(table, dialect);
  return `${quoteIdent(schema, dialect)}.${quoteIdent(table, dialect)}`;
}

/** Build batched INSERT statements from row objects. */
export function buildInsertBatches(
  qualifiedTable: string,
  columns: string[],
  rows: Record<string, unknown>[],
  dialect: "postgres" | "mysql" | "mssql" | "sqlite",
  batchSize: number,
): string[] {
  if (rows.length === 0 || columns.length === 0) return [];
  const colList = columns.map((c) => quoteIdent(c, dialect)).join(", ");
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk
      .map((row) => `(${columns.map((c) => sqlLiteral(row[c], dialect)).join(", ")})`)
      .join(",\n  ");
    statements.push(`INSERT INTO ${qualifiedTable} (${colList}) VALUES\n  ${values};`);
  }
  return statements;
}
