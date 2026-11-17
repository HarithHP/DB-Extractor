import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { BridgeErrorBody } from "@/lib/adapters/diagnostics";
import { extractFromPostgres, testPostgres, type BridgeResult } from "@/lib/bridge/postgres";
import { extractFromMysql, testMysql } from "@/lib/bridge/mysql";
import { extractFromMssql, testMssql } from "@/lib/bridge/mssql";
import { ConnectionConfigSchema, ENGINE_IDS, ExtractionOptionsSchema, type EngineId } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string | null): string {
  if (!hostHeader) return "";
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    return end >= 0 ? hostHeader.slice(0, end + 1).toLowerCase() : hostHeader.toLowerCase();
  }
  return hostHeader.split(":")[0].toLowerCase();
}

function isLocalRequest(req: NextRequest): boolean {
  const host = hostnameOf(req.headers.get("host"));
  if (!LOCAL_HOSTS.has(host)) return false;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const u = new URL(origin);
      if (!LOCAL_HOSTS.has(u.hostname.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

interface EngineHandlers {
  test: (cfg: z.infer<typeof ConnectionConfigSchema>) => Promise<BridgeResult<object>>;
  extract: (
    cfg: z.infer<typeof ConnectionConfigSchema>,
    options: z.infer<typeof ExtractionOptionsSchema>,
  ) => Promise<BridgeResult<object>>;
}

/** Engines with a live driver. Everything else answers 501 DRIVER_NOT_AVAILABLE. */
const HANDLERS: Partial<Record<EngineId, EngineHandlers>> = {
  postgres: { test: testPostgres, extract: extractFromPostgres },
  mysql: { test: testMysql, extract: extractFromMysql },
  mariadb: { test: testMysql, extract: extractFromMysql },
  mssql: { test: testMssql, extract: extractFromMssql },
};

const TestBodySchema = z.object({ connection: ConnectionConfigSchema });
const ExtractBodySchema = z.object({ connection: ConnectionConfigSchema, options: ExtractionOptionsSchema });

function fail(body: BridgeErrorBody, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

/**
 * Stateless localhost-only database bridge.
 *
 * Security invariants:
 * - Rejects any request whose Host or Origin is not localhost / 127.0.0.1 / ::1.
 * - Never logs or persists the request body (which contains decrypted credentials).
 * - Driver error messages are scrubbed of the submitted password before being returned.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ engine: string; action: string }> }) {
  if (!isLocalRequest(req)) {
    return fail(
      {
        ok: false,
        code: "BRIDGE_FORBIDDEN",
        stage: "bridge",
        error: `Bridge only accepts requests from localhost (127.0.0.1); got Host "${req.headers.get("host") ?? ""}" and Origin "${req.headers.get("origin") ?? "none"}".`,
      },
      403,
    );
  }

  const { engine, action } = await context.params;
  if (!ENGINE_IDS.includes(engine as EngineId) || engine === "sqlite") {
    return fail({ ok: false, code: "BRIDGE_BAD_REQUEST", stage: "bridge", error: `Unknown bridged engine "${engine}".` }, 400);
  }
  if (action !== "test" && action !== "extract") {
    return fail({ ok: false, code: "BRIDGE_BAD_REQUEST", stage: "bridge", error: `Unknown bridge action "${action}".` }, 400);
  }

  const handlers = HANDLERS[engine as EngineId];
  if (!handlers) {
    return fail(
      {
        ok: false,
        code: "DRIVER_NOT_AVAILABLE",
        stage: "driver",
        error: `No ${engine} driver is installed in the local bridge (POST /api/bridge/${engine}/${action} → 501 Not Implemented).`,
      },
      501,
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail({ ok: false, code: "BRIDGE_BAD_REQUEST", stage: "bridge", error: "Request body is not valid JSON." }, 400);
  }

  let result: BridgeResult<object>;
  if (action === "test") {
    const parsed = TestBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail({ ok: false, code: "BRIDGE_BAD_REQUEST", stage: "input", error: describeIssues(parsed.error) }, 400);
    }
    result = await handlers.test(parsed.data.connection);
  } else {
    const parsed = ExtractBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail({ ok: false, code: "BRIDGE_BAD_REQUEST", stage: "input", error: describeIssues(parsed.error) }, 400);
    }
    result = await handlers.extract(parsed.data.connection, parsed.data.options);
  }

  if (!result.ok) return fail(result, 502);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
