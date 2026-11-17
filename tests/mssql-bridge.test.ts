import { describe, expect, it } from "vitest";
import { classifyMssqlError } from "@/lib/bridge/mssql/errors";

const target = {
  host: "sqlserver.example.com",
  port: 1433,
  database: "billing_prod",
  username: "sqladmin",
  password: "SqlPassword123#",
};

describe("classifyMssqlError", () => {
  it("maps error number 18456 to DB_AUTH_FAILED", () => {
    const err = {
      number: 18456,
      message: "Login failed for user 'sqladmin'.",
    };
    const res = classifyMssqlError(err, target, "connect");
    expect(res.code).toBe("DB_AUTH_FAILED");
    expect(res.stage).toBe("db_auth");
  });

  it("maps error number 4060 to DB_DATABASE_NOT_FOUND", () => {
    const err = {
      number: 4060,
      message: "Cannot open database 'billing_prod' requested by the login.",
    };
    const res = classifyMssqlError(err, target, "connect");
    expect(res.code).toBe("DB_DATABASE_NOT_FOUND");
    expect(res.stage).toBe("db_auth");
  });

  it("maps ECONNREFUSED to DB_CONNECTION_REFUSED", () => {
    const err = {
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:1433",
    };
    const res = classifyMssqlError(err, target, "connect");
    expect(res.code).toBe("DB_CONNECTION_REFUSED");
    expect(res.stage).toBe("db_network");
  });

  it("maps ENOTFOUND to DB_HOST_NOT_FOUND", () => {
    const err = {
      code: "ENOTFOUND",
      message: "getaddrinfo ENOTFOUND invalid.host",
    };
    const res = classifyMssqlError(err, target, "connect");
    expect(res.code).toBe("DB_HOST_NOT_FOUND");
    expect(res.stage).toBe("db_network");
  });

  it("scrubs password from raw error message", () => {
    const err = {
      message: `TDS handshake failed with secret=${target.password}`,
    };
    const res = classifyMssqlError(err, target, "connect");
    expect(res.error).not.toContain(target.password);
    expect(res.error).toContain("[REDACTED]");
  });
});
