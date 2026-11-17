import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { NextRequest } from "next/server";
import { classifyPgError, type PgTarget } from "@/lib/bridge/postgres/errors";
import { extractFromPostgres, testPostgres } from "@/lib/bridge/postgres";
import { POST } from "@/app/api/bridge/[engine]/[action]/route";
import { DEFAULT_EXTRACTION_OPTIONS, type ConnectionConfig } from "@/lib/schemas";

const target: PgTarget = {
  host: "db.example.com",
  port: 5432,
  database: "shop",
  username: "app",
  password: "S3cret-Pass!",
};

describe("classifyPgError", () => {
  it.each([
    ["28P01", "DB_AUTH_FAILED", "db_auth"],
    ["28000", "DB_ACCESS_REJECTED", "db_auth"],
    ["3D000", "DB_DATABASE_NOT_FOUND", "db_auth"],
    ["42501", "DB_PERMISSION_DENIED", "db_query"],
    ["53300", "DB_TOO_MANY_CONNECTIONS", "db_auth"],
    ["57P03", "DB_SERVER_UNAVAILABLE", "db_auth"],
    ["57014", "DB_TIMEOUT", "db_query"],
  ])("maps SQLSTATE %s to %s", (sqlState, code, stage) => {
    const body = classifyPgError(Object.assign(new Error("server said no"), { code: sqlState }), target);
    expect(body).toMatchObject({ ok: false, code, stage, sqlState, error: "server said no" });
    expect(body.driverCode).toBeUndefined();
  });

  it.each([
    ["ECONNREFUSED", "DB_CONNECTION_REFUSED"],
    ["ENOTFOUND", "DB_HOST_NOT_FOUND"],
    ["ETIMEDOUT", "DB_TIMEOUT"],
    ["ECONNRESET", "DB_CONNECTION_RESET"],
  ])("maps network code %s to %s", (driverCode, code) => {
    const body = classifyPgError(Object.assign(new Error(`connect ${driverCode}`), { code: driverCode }), target);
    expect(body).toMatchObject({ code, stage: "db_network", driverCode });
    expect(body.sqlState).toBeUndefined();
  });

  it("unwraps Node's AggregateError (dual-stack connect failures)", () => {
    const inner = [
      Object.assign(new Error("connect ECONNREFUSED ::1:5432"), { code: "ECONNREFUSED" }),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
    ];
    const body = classifyPgError(new AggregateError(inner, ""), target);
    expect(body.code).toBe("DB_CONNECTION_REFUSED");
    expect(body.error).toBe("connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432");
    expect(body.errorName).toBe("AggregateError");
  });

  it("classifies TLS problems with a mode-specific hint", () => {
    const off = classifyPgError(new Error("The server does not support SSL connections"), target);
    expect(off).toMatchObject({ code: "DB_TLS_ERROR", stage: "db_tls" });
    expect(off.hint).toMatch(/Disable/);

    const selfSigned = classifyPgError(
      Object.assign(new Error("self-signed certificate in certificate chain"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }),
      target,
    );
    expect(selfSigned.code).toBe("DB_TLS_ERROR");
    expect(selfSigned.hint).toMatch(/Require/);
  });

  it("scrubs the submitted password from the driver message", () => {
    const body = classifyPgError(new Error(`bad option near 'S3cret-Pass!'`), target);
    expect(body.error).not.toContain("S3cret-Pass!");
    expect(body.error).toContain("[REDACTED]");
  });

  it("falls back to DB_QUERY_FAILED during extraction and DB_ERROR otherwise", () => {
    expect(classifyPgError(new Error("weird"), target, "query").code).toBe("DB_QUERY_FAILED");
    expect(classifyPgError(new Error("weird"), target, "connect")).toMatchObject({ code: "DB_ERROR", stage: "driver" });
  });
});

const FIXTURE_SQL = `
CREATE SCHEMA app;
CREATE TYPE app.order_status AS ENUM ('new', 'paid', 'shipped');
CREATE DOMAIN app.email AS text CHECK (VALUE LIKE '%@%');
CREATE SEQUENCE app.invoice_seq START 1000 INCREMENT 5;

CREATE TABLE app.customers (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email app.email NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'anonymous',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.orders (
  id bigserial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES app.customers(id) ON DELETE CASCADE,
  status app.order_status NOT NULL DEFAULT 'new',
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  updated_at timestamptz
);
CREATE INDEX orders_customer_idx ON app.orders (customer_id, status);

CREATE VIEW app.v_open_orders AS SELECT id, customer_id, total FROM app.orders WHERE status <> 'shipped';
CREATE MATERIALIZED VIEW app.mv_customer_totals AS
  SELECT customer_id, sum(total) AS total FROM app.orders GROUP BY customer_id;

CREATE FUNCTION app.order_total(p_customer integer) RETURNS numeric
  LANGUAGE sql STABLE AS $$ SELECT coalesce(sum(total), 0) FROM app.orders WHERE customer_id = p_customer $$;

CREATE PROCEDURE app.mark_shipped(p_order bigint)
  LANGUAGE plpgsql AS $$ BEGIN UPDATE app.orders SET status = 'shipped' WHERE id = p_order; END $$;

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER orders_touch BEFORE UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
`;

describe("PostgreSQL bridge against a live server (PGlite)", () => {
  let db: PGlite;
  let server: PGLiteSocketServer;
  let cfg: ConnectionConfig;

  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(FIXTURE_SQL);
    server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0 });
    await server.start();
    const port = Number(server.getServerConn().split(":").pop());
    cfg = {
      projectId: "test",
      engine: "postgres",
      host: "127.0.0.1",
      port,
      database: "postgres",
      username: "postgres",
      password: "postgres",
      ssl: "disable",
    };
  }, 60_000);

  afterAll(async () => {
    await server?.stop();
    await db?.close();
  });

  it("tests the connection and reports the server version", async () => {
    const res = await testPostgres(cfg);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.serverVersion).toMatch(/^PostgreSQL \d+/);
  });

  it("extracts every object category from pg_catalog", async () => {
    const res = await extractFromPostgres(cfg, DEFAULT_EXTRACTION_OPTIONS);
    if (!res.ok) throw new Error(`${res.code}: ${res.error}`);

    // schemas: public + app; sequences: invoice_seq + the bigserial's orders_id_seq (identity sequences are skipped).
    expect(res.counts).toMatchObject({
      schemas: 2,
      tables: 2,
      views: 2,
      functions: 2,
      procedures: 1,
      triggers: 1,
      sequences: 2,
    });
    expect(res.counts.indexes).toBeGreaterThanOrEqual(1);
    expect(res.counts.foreign_keys).toBe(1);

    const byName = new Map(res.files.map((f) => [f.filename, f.content]));
    const all = res.files.map((f) => f.content).join("\n");

    expect(all).toContain("CREATE SCHEMA IF NOT EXISTS app;");
    expect(all).toMatch(/CREATE TYPE app\.order_status AS ENUM \('new', 'paid', 'shipped'\)/);
    expect(all).toMatch(/CREATE DOMAIN app\.email AS text/);
    expect(all).toMatch(/CREATE SEQUENCE IF NOT EXISTS app\.invoice_seq/);
    expect(all).toContain("ALTER SEQUENCE app.orders_id_seq OWNED BY app.orders.id;");
    expect(all).not.toMatch(/CREATE SEQUENCE[^\n]*customers_id_seq/);
    expect(all).toMatch(/GENERATED ALWAYS AS IDENTITY/);
    expect(all).toMatch(/REFERENCES app\.customers\s*\(id\) ON DELETE CASCADE/);
    expect(all).toMatch(/CHECK \(\(?total >= \(?0/);
    expect(all).toContain("CREATE INDEX IF NOT EXISTS orders_customer_idx ON app.orders USING btree (customer_id, status);");
    expect(all).toMatch(/CREATE OR REPLACE VIEW app\.v_open_orders/);
    expect(all).toMatch(/CREATE MATERIALIZED VIEW (IF NOT EXISTS )?app\.mv_customer_totals/);
    expect(all).toMatch(/CREATE OR REPLACE FUNCTION app\.order_total/);
    expect(all).toMatch(/CREATE OR REPLACE PROCEDURE app\.mark_shipped/);
    expect(all).toMatch(/CREATE (OR REPLACE )?TRIGGER orders_touch/);
    expect(all).not.toMatch(/CREATE TABLE (IF NOT EXISTS )?(pg_catalog|information_schema)\./);

    expect([...byName.keys()].some((n) => n.startsWith("objects/tables/app.customers"))).toBe(true);
    expect([...byName.keys()].some((n) => n.startsWith("objects/types/"))).toBe(true);
    expect(res.files.every((f) => f.content.length > 0)).toBe(true);
  });

  it("honors include toggles and excluded schemas", async () => {
    const res = await extractFromPostgres(cfg, { ...DEFAULT_EXTRACTION_OPTIONS, excludedSchemas: ["app"] });
    if (!res.ok) throw new Error(res.error);
    expect(res.counts.tables ?? 0).toBe(0);
    expect(res.counts.functions ?? 0).toBe(0);
  });

  it("returns a classified, password-free error when nothing listens on the port", async () => {
    const closedPort = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const port = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(port));
      });
    });
    const res = await testPostgres({ ...cfg, port: closedPort, password: "Zz-Unique-Pass-42" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("DB_CONNECTION_REFUSED");
      expect(res.stage).toBe("db_network");
      expect(res.driverCode).toBe("ECONNREFUSED");
      expect(res.error).toMatch(/ECONNREFUSED/);
      expect(JSON.stringify(res)).not.toContain("Zz-Unique-Pass-42");
    }
  });

  it("serves the bridge route end-to-end", async () => {
    const call = (engine: string, action: string, body: unknown, host = "127.0.0.1:3000") =>
      POST(
        new NextRequest(`http://${host}/api/bridge/${engine}/${action}`, {
          method: "POST",
          headers: { host, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ engine, action }) },
      );

    const ok = await call("postgres", "test", { connection: cfg });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });

    const bad = await call("postgres", "test", { connection: { ...cfg, port: "nope" } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "BRIDGE_BAD_REQUEST" });

    const notYet = await call("oracle", "test", { connection: { ...cfg, engine: "oracle" } });
    expect(notYet.status).toBe(501);
    expect(await notYet.json()).toMatchObject({ code: "DRIVER_NOT_AVAILABLE" });

    const remote = await call("postgres", "test", { connection: cfg }, "evil.example.com");
    expect(remote.status).toBe(403);
  });
});
