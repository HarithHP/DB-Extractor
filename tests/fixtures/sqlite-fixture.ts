import { getSqlJs } from "@/lib/adapters/sqlite";

/**
 * Builds a deterministic in-memory SQLite database containing tables, a primary key,
 * a foreign key, an index, a view, and a trigger (plus an internal `sqlite_sequence`
 * row via AUTOINCREMENT to verify system-object exclusion).
 */
export async function buildSampleSqliteBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_orders_customer ON orders(customer_id);

    CREATE VIEW v_customer_orders AS
      SELECT c.id AS customer_id, c.email, COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
       GROUP BY c.id, c.email;

    CREATE TRIGGER trg_orders_nonnegative
    BEFORE INSERT ON orders
    BEGIN
      SELECT CASE WHEN NEW.total_cents < 0 THEN RAISE(ABORT, 'negative total') END;
    END;
  `);
  const exported = db.export();
  db.close();
  return new Uint8Array(exported);
}
