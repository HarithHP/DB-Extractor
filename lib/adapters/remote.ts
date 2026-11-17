import type { EngineId, ObjectCategory } from "@/lib/schemas";
import {
  ConnectionError,
  FAILURE_CODES,
  FAILURE_STAGES,
  failureFromError,
  makeFailure,
  type ConnectionFailure,
  type FailureCode,
  type FailureStage,
} from "./diagnostics";
import type { AdapterExtractionOutput, ConnectionHandle, DbAdapter, ResolvedConnection, TestResult } from "./types";

export { describeBridgeError, isServerUnreachable } from "./diagnostics";

interface BridgeBody {
  ok?: boolean;
  code?: string;
  stage?: string;
  title?: string;
  error?: string;
  hint?: string;
  sqlState?: string;
  driverCode?: string;
  errorName?: string;
  serverVersion?: string;
}

const KNOWN_CODES = new Set<string>(FAILURE_CODES);
const KNOWN_STAGES = new Set<string>(FAILURE_STAGES);

function codeForStatus(status: number): FailureCode {
  if (status === 403) return "BRIDGE_FORBIDDEN";
  if (status === 400) return "BRIDGE_BAD_REQUEST";
  if (status === 501) return "DRIVER_NOT_AVAILABLE";
  return "BRIDGE_HTTP_ERROR";
}

const TITLES: Partial<Record<FailureCode, (name: string) => string>> = {
  BRIDGE_FORBIDDEN: () => "The local bridge refused the request",
  BRIDGE_BAD_REQUEST: () => "The local bridge rejected the request",
  DRIVER_NOT_AVAILABLE: (name) => `${name} driver is not available yet`,
  BRIDGE_HTTP_ERROR: () => "The local bridge returned an error",
  BRIDGE_BAD_RESPONSE: () => "The local bridge sent an unreadable response",
};

const HINTS: Partial<Record<FailureCode, (name: string) => string>> = {
  BRIDGE_FORBIDDEN: () => "Open the app at http://127.0.0.1:9000 or http://localhost:9000; the bridge only accepts local requests.",
  DRIVER_NOT_AVAILABLE: (name) =>
    `Live ${name} connections arrive with a later Milestone 5 driver. SQLite and PostgreSQL projects work fully today.`,
  BRIDGE_HTTP_ERROR: () => "Check the terminal running `npm start` for a server-side stack trace.",
};

/** POSTs to the bridge and returns the parsed body, or throws a classified ConnectionError. */
async function callBridge(engine: EngineId, displayName: string, action: "test" | "extract", payload: unknown) {
  const endpoint = `/api/bridge/${engine}/${action}`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new ConnectionError(failureFromError(err, { endpoint }));
  }

  const text = await res.text().catch(() => "");
  let body: BridgeBody | undefined;
  try {
    body = text ? (JSON.parse(text) as BridgeBody) : undefined;
  } catch {
    body = undefined;
  }

  if (res.ok && body?.ok !== false && body !== undefined) return { body, endpoint };

  const code: FailureCode =
    body === undefined && res.ok
      ? "BRIDGE_BAD_RESPONSE"
      : body?.code && KNOWN_CODES.has(body.code as FailureCode)
        ? (body.code as FailureCode)
        : codeForStatus(res.status);

  const stage: FailureStage =
    body?.stage && KNOWN_STAGES.has(body.stage)
      ? (body.stage as FailureStage)
      : code === "DRIVER_NOT_AVAILABLE"
        ? "driver"
        : "bridge";

  const failure: ConnectionFailure = {
    code,
    stage,
    title: body?.title ?? TITLES[code]?.(displayName) ?? "Connection test failed",
    message: body?.error ?? (text || `HTTP ${res.status} ${res.statusText}`.trim()),
    hint: body?.hint ?? HINTS[code]?.(displayName),
    sqlState: body?.sqlState,
    driverCode: body?.driverCode,
    errorName: body?.errorName,
    httpStatus: res.status,
    endpoint,
    responseBody: text || undefined,
  };
  throw new ConnectionError(failure);
}

export function createRemoteAdapter(opts: {
  engine: EngineId;
  displayName: string;
  defaultPort: number;
  /** True once the local bridge ships a live driver for this engine. */
  available?: boolean;
}): DbAdapter {
  return {
    engine: opts.engine,
    displayName: opts.displayName,
    requiresNetwork: true,
    supportedInCurrentMilestone: opts.available ?? false,
    defaultPort: opts.defaultPort,

    async testConnection(cfg: ResolvedConnection): Promise<TestResult> {
      const started = performance.now();
      const latency = () => Math.round(performance.now() - started);
      try {
        const { body } = await callBridge(opts.engine, opts.displayName, "test", { connection: cfg });
        return { ok: true, latencyMs: latency(), serverVersion: body.serverVersion };
      } catch (err) {
        const failure = failureFromError(err);
        return { ok: false, latencyMs: latency(), message: failure.message, failure: makeFailure(failure) };
      }
    },

    async connect(cfg: ResolvedConnection): Promise<ConnectionHandle> {
      return { engine: opts.engine, raw: cfg };
    },

    async extractAll(conn, options, onProgress): Promise<AdapterExtractionOutput> {
      onProgress({ kind: "phase", phase: "extract" });
      let data: Partial<AdapterExtractionOutput>;
      try {
        ({ body: data } = (await callBridge(opts.engine, opts.displayName, "extract", {
          connection: conn.raw,
          options,
        })) as { body: Partial<AdapterExtractionOutput> });
      } catch (err) {
        const f = failureFromError(err);
        throw new Error(`${f.title}: ${f.message}${f.hint ? ` (${f.hint})` : ""}`);
      }
      for (const [category, n] of Object.entries(data.counts ?? {}) as [ObjectCategory, number][]) {
        onProgress({ kind: "category", category, done: n, total: n });
      }
      return {
        files: data.files ?? [],
        counts: data.counts ?? {},
        warnings: data.warnings ?? [],
        serverVersion: data.serverVersion,
      };
    },

    async close() {
      // Stateless HTTP bridge — nothing to close on the client.
    },
  };
}
