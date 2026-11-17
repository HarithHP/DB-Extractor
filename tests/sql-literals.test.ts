import { describe, expect, it } from "vitest";
import { buildInsertBatches, sqlLiteral, quoteIdent } from "@/lib/bridge/sql-literals";

describe("sqlLiteral", () => {
  it("escapes strings and nulls", () => {
    expect(sqlLiteral(null, "mssql")).toBe("NULL");
    expect(sqlLiteral("O'Brien", "mssql")).toBe("'O''Brien'");
    expect(sqlLiteral(true, "postgres")).toBe("TRUE");
    expect(sqlLiteral(true, "mysql")).toBe("1");
  });

  it("formats binary for dialects", () => {
    const bytes = new Uint8Array([0xde, 0xad]);
    expect(sqlLiteral(bytes, "mssql")).toBe("0xdead");
    expect(sqlLiteral(bytes, "mysql")).toBe("X'dead'");
    expect(sqlLiteral(bytes, "postgres")).toBe("'\\xdead'::bytea");
  });
});

describe("buildInsertBatches", () => {
  it("batches rows", () => {
    const rows = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ];
    const stmts = buildInsertBatches("dbo.t", ["id", "name"], rows, "mssql", 2);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("INSERT INTO dbo.t");
    expect(stmts[0]).toContain("(1, 'a')");
    expect(stmts[0]).toContain("(2, 'b')");
    expect(stmts[1]).toContain("(3, 'c')");
  });
});

describe("quoteIdent", () => {
  it("quotes identifiers per dialect", () => {
    expect(quoteIdent("Order", "mssql")).toBe("[Order]");
    expect(quoteIdent("Order", "mysql")).toBe("`Order`");
    expect(quoteIdent('a"b', "postgres")).toBe('"a""b"');
  });
});
