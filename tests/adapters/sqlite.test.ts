import { describe, expect, it } from "vitest";
import { sqliteAdapter } from "@/lib/adapters/sqlite";
import { DEFAULT_EXTRACTION_OPTIONS } from "@/lib/schemas";
import { buildSampleSqliteBytes } from "../fixtures/sqlite-fixture";

describe("sqliteAdapter", () => {
  it("tests connection and reports the SQLite version", async () => {
    const sqliteBytes = await buildSampleSqliteBytes();
    const res = await sqliteAdapter.testConnection({
      projectId: "proj-1",
      engine: "sqlite",
      database: "shop.db",
      sqliteBytes,
    });
    expect(res.ok).toBe(true);
    expect(res.serverVersion).toMatch(/^SQLite 3\./);
  });

  it("extracts tables, columns, keys, indexes, views, triggers + per-object files deterministically", async () => {
    const sqliteBytes = await buildSampleSqliteBytes();
    const conn = await sqliteAdapter.connect({
      projectId: "proj-1",
      engine: "sqlite",
      database: "shop.db",
      sqliteBytes,
    });

    const out = await sqliteAdapter.extractAll(
      conn,
      { ...DEFAULT_EXTRACTION_OPTIONS, dropFirst: true, useIfNotExists: true },
      () => {},
    );
    await sqliteAdapter.close(conn);

    const filenames = out.files.map((f) => f.filename);
    expect(filenames).toEqual([
      "01_tables.sql",
      "objects/tables/main.customers.sql",
      "objects/tables/main.orders.sql",
      "02_table_columns.sql",
      "objects/columns/main.customers.sql",
      "objects/columns/main.orders.sql",
      "03_primary_keys.sql",
      "objects/primary_keys/main.customers.sql",
      "objects/primary_keys/main.orders.sql",
      "04_foreign_keys.sql",
      "objects/foreign_keys/main.orders.sql",
      "05_indexes.sql",
      "objects/indexes/main.idx_orders_customer.sql",
      "07_views.sql",
      "objects/views/main.v_customer_orders.sql",
      "10_triggers.sql",
      "objects/triggers/main.trg_orders_nonnegative.sql",
    ]);

    expect(out.counts).toMatchObject({
      tables: 2,
      columns: 2,
      primary_keys: 2,
      foreign_keys: 1,
      indexes: 1,
      views: 1,
      triggers: 1,
    });

    // System table `sqlite_sequence` must be filtered out when excludeSystemSchemas is true.
    const tablesFile = out.files.find((f) => f.filename === "01_tables.sql")!;
    expect(tablesFile.content).not.toContain("sqlite_sequence");
    expect(tablesFile.content).toContain('DROP TABLE IF EXISTS "customers";');
    expect(tablesFile.content).toContain("CREATE TABLE IF NOT EXISTS customers");

    const byName = Object.fromEntries(out.files.map((f) => [f.filename, f.content]));
    expect(byName).toMatchSnapshot();
  });
});
