import { redactString } from "@/lib/services/log.service";

/** Where in the pipeline a connection test failed. */
export type FailureStage =
  | "input"
  | "vault"
  | "network"
  | "bridge"
  | "driver"
  | "db_network"
  | "db_tls"
  | "db_auth"
  | "db_query";

export const FAILURE_STAGE_LABEL: Record<FailureStage, string> = {
  input: "Form input",
  vault: "Encrypted vault",
  network: "Network (browser → app server)",
  bridge: "Local bridge (app server)",
  driver: "Database driver",
  db_network: "Network (app server → database)",
  db_tls: "SSL / TLS handshake",
  db_auth: "Database login",
  db_query: "Database query",
};

export const FAILURE_STAGES = Object.keys(FAILURE_STAGE_LABEL) as FailureStage[];

export const FAILURE_CODES = [
  "INPUT_MISSING",
  "VAULT_READ_FAILED",
  "SERVER_UNREACHABLE",
  "BRIDGE_FORBIDDEN",
  "BRIDGE_BAD_REQUEST",
  "BRIDGE_HTTP_ERROR",
  "BRIDGE_BAD_RESPONSE",
  "DRIVER_NOT_AVAILABLE",
  "SQLITE_ENGINE_LOAD_FAILED",
  "SQLITE_FILE_READ_FAILED",
  "SQLITE_OPEN_FAILED",
  "DB_HOST_NOT_FOUND",
  "DB_CONNECTION_REFUSED",
  "DB_TIMEOUT",
  "DB_CONNECTION_RESET",
  "DB_TLS_ERROR",
  "DB_AUTH_FAILED",
  "DB_ACCESS_REJECTED",
  "DB_DATABASE_NOT_FOUND",
  "DB_PERMISSION_DENIED",
  "DB_TOO_MANY_CONNECTIONS",
  "DB_SERVER_UNAVAILABLE",
  "DB_QUERY_FAILED",
  "DB_ERROR",
  "UNKNOWN",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export interface ConnectionFailure {
  code: FailureCode;
  stage: FailureStage;
  /** One-line human summary. */
  title: string;
  /** The exact error message produced by the failing component (secrets redacted). */
  message: string;
  hint?: string;
  errorName?: string;
  /** PostgreSQL SQLSTATE (e.g. 28P01) or the equivalent for other engines. */
  sqlState?: string;
  /** Node / driver error code (e.g. ECONNREFUSED, SELF_SIGNED_CERT_IN_CHAIN). */
  driverCode?: string;
  httpStatus?: number;
  endpoint?: string;
  /** Raw response body from the bridge, truncated (secrets redacted). */
  responseBody?: string;
}

/** JSON body the bridge route returns on failure. */
export interface BridgeErrorBody {
  ok: false;
  code: FailureCode;
  stage?: FailureStage;
  title?: string;
  error: string;
  hint?: string;
  sqlState?: string;
  driverCode?: string;
  errorName?: string;
}

const MAX_BODY = 4000;

/** Builds a failure, scrubbing secrets from anything that came from an error or a response. */
export function makeFailure(f: ConnectionFailure): ConnectionFailure {
  return {
    ...f,
    message: redactString(f.message),
    responseBody: f.responseBody ? redactString(f.responseBody.slice(0, MAX_BODY)) : undefined,
  };
}

/** Thrown inside adapters to carry a classified failure up to testConnection. */
export class ConnectionError extends Error {
  readonly failure: ConnectionFailure;
  constructor(failure: ConnectionFailure) {
    super(failure.message);
    this.name = "ConnectionError";
    this.failure = makeFailure(failure);
  }
}

// Network-failure messages from Chrome/Edge, Node, Firefox, Safari, sql.js's WASM loader, and Next chunk loads.
const UNREACHABLE =
  /failed to fetch|fetch failed|networkerror|load failed|fetching of the wasm failed|loading chunk|failed to load chunk/i;

export function isServerUnreachable(err: unknown): boolean {
  return UNREACHABLE.test(err instanceof Error ? `${err.name} ${err.message}` : String(err));
}

export const SERVER_UNREACHABLE_HINT =
  "Could not reach the local app server. Make sure `npm start` (or `npm run dev`) is still running, then try again.";

export function describeBridgeError(err: unknown): string {
  if (isServerUnreachable(err)) return SERVER_UNREACHABLE_HINT;
  return err instanceof Error ? err.message : String(err);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Classifies an arbitrary thrown value. */
export function failureFromError(err: unknown, fallback?: Partial<ConnectionFailure>): ConnectionFailure {
  if (err instanceof ConnectionError) return err.failure;
  const message = errorMessage(err);
  const errorName = err instanceof Error ? err.name : undefined;
  if (isServerUnreachable(err)) {
    return makeFailure({
      code: "SERVER_UNREACHABLE",
      stage: "network",
      title: "Can't reach the local app server",
      message,
      errorName,
      hint: SERVER_UNREACHABLE_HINT,
      ...fallback,
    });
  }
  return makeFailure({
    code: "UNKNOWN",
    stage: "driver",
    title: "Connection test failed",
    message,
    errorName,
    ...fallback,
  });
}
