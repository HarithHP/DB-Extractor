import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionError, failureFromError } from "@/lib/adapters/diagnostics";
import { postgresAdapter } from "@/lib/adapters/postgres";
import { sqliteAdapter } from "@/lib/adapters/sqlite";
import type { ResolvedConnection } from "@/lib/adapters/types";
import { clearRegisteredSecrets, registerSecretForRedaction } from "@/lib/services/log.service";

const pgCfg: ResolvedConnection = {
  projectId: "p1",
  engine: "postgres",
  host: "db.local",
  port: 5432,
  database: "billing",
  username: "app",
  password: "s3cret-pass",
};

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearRegisteredSecrets();
});

describe("remote adapter diagnostics", () => {
  it("keeps the bridge's exact message, code, hint, status and raw body", async () => {
    const body = { ok: false, code: "DRIVER_NOT_AVAILABLE", error: "No postgres driver is installed.", hint: "Milestone 5." };
    mockFetch(async () => new Response(JSON.stringify(body), { status: 501 }));

    const res = await postgresAdapter.testConnection(pgCfg);
    expect(res.ok).toBe(false);
    expect(res.message).toBe("No postgres driver is installed.");
    expect(res.failure).toMatchObject({
      code: "DRIVER_NOT_AVAILABLE",
      stage: "driver",
      httpStatus: 501,
      endpoint: "/api/bridge/postgres/test",
      hint: "Milestone 5.",
      title: "PostgreSQL driver is not available yet",
    });
    expect(res.failure?.responseBody).toBe(JSON.stringify(body));
  });

  it("passes through a classified database error from the live driver", async () => {
    const body = {
      ok: false,
      code: "DB_AUTH_FAILED",
      stage: "db_auth",
      title: 'Password authentication failed for user "app"',
      error: 'password authentication failed for user "app"',
      hint: "Double-check the username and password.",
      sqlState: "28P01",
      errorName: "error",
    };
    mockFetch(async () => new Response(JSON.stringify(body), { status: 502 }));

    const res = await postgresAdapter.testConnection(pgCfg);
    expect(res.failure).toMatchObject({
      code: "DB_AUTH_FAILED",
      stage: "db_auth",
      title: body.title,
      message: body.error,
      sqlState: "28P01",
      httpStatus: 502,
    });
    expect(postgresAdapter.supportedInCurrentMilestone).toBe(true);
  });

  it("classifies a 403 without a code as BRIDGE_FORBIDDEN", async () => {
    mockFetch(async () => new Response(JSON.stringify({ ok: false, error: "nope" }), { status: 403 }));
    const res = await postgresAdapter.testConnection(pgCfg);
    expect(res.failure).toMatchObject({ code: "BRIDGE_FORBIDDEN", stage: "bridge", message: "nope" });
  });

  it("reports an unreachable server as a network failure with the browser's own message", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const res = await postgresAdapter.testConnection(pgCfg);
    expect(res.failure).toMatchObject({
      code: "SERVER_UNREACHABLE",
      stage: "network",
      message: "Failed to fetch",
      errorName: "TypeError",
      endpoint: "/api/bridge/postgres/test",
    });
    expect(res.failure?.hint).toMatch(/npm start/);
  });

  it("surfaces a non-JSON error page verbatim", async () => {
    mockFetch(async () => new Response("<html>Internal Server Error</html>", { status: 500 }));
    const res = await postgresAdapter.testConnection(pgCfg);
    expect(res.failure).toMatchObject({ code: "BRIDGE_HTTP_ERROR", httpStatus: 500 });
    expect(res.message).toBe("<html>Internal Server Error</html>");
  });

  it("redacts registered secrets from messages and raw bodies", async () => {
    registerSecretForRedaction(pgCfg.password);
    mockFetch(
      async () =>
        new Response(JSON.stringify({ ok: false, error: `auth failed for password ${pgCfg.password}` }), { status: 500 }),
    );
    const res = await postgresAdapter.testConnection(pgCfg);
    expect(res.message).not.toContain(pgCfg.password);
    expect(res.failure?.responseBody).not.toContain(pgCfg.password);
  });
});

describe("sqlite adapter diagnostics", () => {
  it("reports a non-SQLite file as SQLITE_OPEN_FAILED with sql.js's exact message", async () => {
    const res = await sqliteAdapter.testConnection({
      projectId: "p2",
      engine: "sqlite",
      database: "notes",
      sqliteBytes: new TextEncoder().encode("this is definitely not a sqlite database, just text padding....") as Uint8Array<ArrayBuffer>,
    });
    expect(res.ok).toBe(false);
    expect(res.failure?.code).toBe("SQLITE_OPEN_FAILED");
    expect(res.failure?.stage).toBe("driver");
    expect(res.message).toMatch(/not a database/i);
  });
});

describe("failureFromError", () => {
  it("passes ConnectionError failures through unchanged", () => {
    const err = new ConnectionError({ code: "INPUT_MISSING", stage: "input", title: "t", message: "m" });
    expect(failureFromError(err)).toEqual(err.failure);
  });
});
