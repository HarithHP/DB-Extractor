import { describe, expect, it } from "vitest";
import { classifyMysqlError } from "@/lib/bridge/mysql/errors";

const target = {
  host: "db.example.com",
  port: 3306,
  database: "testdb",
  username: "myuser",
  password: "SuperSecretPassword123!",
};

describe("classifyMysqlError", () => {
  it("maps ER_ACCESS_DENIED_ERROR (1045) to DB_AUTH_FAILED", () => {
    const err = {
      errno: 1045,
      code: "ER_ACCESS_DENIED_ERROR",
      message: "Access denied for user 'myuser'@'%' (using password: YES)",
    };
    const res = classifyMysqlError(err, target, "connect");
    expect(res.code).toBe("DB_AUTH_FAILED");
    expect(res.stage).toBe("db_auth");
  });

  it("maps ER_BAD_DB_ERROR (1049) to DB_DATABASE_NOT_FOUND", () => {
    const err = {
      errno: 1049,
      code: "ER_BAD_DB_ERROR",
      message: "Unknown database 'testdb'",
    };
    const res = classifyMysqlError(err, target, "connect");
    expect(res.code).toBe("DB_DATABASE_NOT_FOUND");
    expect(res.stage).toBe("db_auth");
  });

  it("maps ECONNREFUSED to DB_CONNECTION_REFUSED", () => {
    const err = {
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:3306",
    };
    const res = classifyMysqlError(err, target, "connect");
    expect(res.code).toBe("DB_CONNECTION_REFUSED");
    expect(res.stage).toBe("db_network");
  });

  it("maps ENOTFOUND to DB_HOST_NOT_FOUND", () => {
    const err = {
      code: "ENOTFOUND",
      message: "getaddrinfo ENOTFOUND invalid.domain",
    };
    const res = classifyMysqlError(err, target, "connect");
    expect(res.code).toBe("DB_HOST_NOT_FOUND");
    expect(res.stage).toBe("db_network");
  });

  it("scrubs password from raw error message", () => {
    const err = {
      code: "UNKNOWN_ERR",
      message: `Failed with credentials user: myuser, pass: ${target.password}`,
    };
    const res = classifyMysqlError(err, target, "connect");
    expect(res.error).not.toContain(target.password);
    expect(res.error).toContain("[REDACTED]");
  });
});
