import type { ExtractionOptions } from "@/lib/schemas";

export function isExcludedSchema(schema: string, opts: ExtractionOptions): boolean {
  const name = schema.toLowerCase();
  if (opts.excludeSystemSchemas) {
    const system = ["sys", "information_schema", "pg_catalog", "pg_toast", "mysql", "performance_schema", "sysadmin"];
    if (system.includes(name)) return true;
    if (name.startsWith("pg_")) return true;
  }
  for (const prefix of opts.excludedSchemas) {
    const p = prefix.toLowerCase();
    if (!p) continue;
    if (name === p || name.startsWith(p)) return true;
  }
  return false;
}

export function isExcludedTable(schema: string | undefined, table: string, opts: ExtractionOptions): boolean {
  if (schema && isExcludedSchema(schema, opts)) return true;
  const name = table.toLowerCase();
  for (const prefix of opts.excludedSchemas) {
    const p = prefix.toLowerCase();
    if (!p) continue;
    if (name === p || name.startsWith(p)) return true;
  }
  return false;
}
