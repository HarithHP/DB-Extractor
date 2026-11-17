import type { BridgeErrorBody, FailureCode, FailureStage } from "@/lib/adapters/diagnostics";

export interface PgTarget {
  host: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
  ssl?: string;
}

interface Classified {
  code: FailureCode;
  stage: FailureStage;
  title: string;
  hint?: string;
}

const NETWORK_CODES: Record<string, (t: PgTarget) => Classified> = {
  ENOTFOUND: (t) => ({
    code: "DB_HOST_NOT_FOUND",
    stage: "db_network",
    title: `Host "${t.host}" could not be resolved`,
    hint: "Check the Host field for typos. If it's a name on your network or VPN, make sure this machine can resolve it (try `ping <host>`).",
  }),
  EAI_AGAIN: (t) => ({
    code: "DB_HOST_NOT_FOUND",
    stage: "db_network",
    title: `DNS lookup for "${t.host}" failed`,
    hint: "DNS is temporarily unavailable. Check your network / VPN connection and try again.",
  }),
  ECONNREFUSED: (t) => ({
    code: "DB_CONNECTION_REFUSED",
    stage: "db_network",
    title: `Nothing is accepting connections on ${t.host}:${t.port}`,
    hint: "Make sure PostgreSQL is running and listening on this host/port (`listen_addresses` and `port` in postgresql.conf), and that no firewall blocks it.",
  }),
  ETIMEDOUT: (t) => ({
    code: "DB_TIMEOUT",
    stage: "db_network",
    title: `Timed out connecting to ${t.host}:${t.port}`,
    hint: "The host did not answer. Check the host/port, firewall rules, security groups, or whether a VPN / SSH tunnel is required.",
  }),
  EHOSTUNREACH: (t) => ({
    code: "DB_TIMEOUT",
    stage: "db_network",
    title: `Host ${t.host} is unreachable`,
    hint: "There is no network route to this host. Check VPN / routing, or use an SSH tunnel and point Host at 127.0.0.1.",
  }),
  ENETUNREACH: (t) => ({
    code: "DB_TIMEOUT",
    stage: "db_network",
    title: `Network to ${t.host} is unreachable`,
    hint: "There is no network route to this host. Check VPN / routing.",
  }),
  ECONNRESET: () => ({
    code: "DB_CONNECTION_RESET",
    stage: "db_network",
    title: "The database server closed the connection",
    hint: "Often caused by an SSL mode mismatch, a proxy/pooler in between, or the server restarting. Try a different SSL / TLS mode.",
  }),
  EPIPE: () => ({
    code: "DB_CONNECTION_RESET",
    stage: "db_network",
    title: "The database server closed the connection",
  }),
};

const TLS_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "EPROTO",
]);

function bySqlState(sqlState: string, t: PgTarget): Classified | undefined {
  switch (sqlState) {
    case "28P01":
      return {
        code: "DB_AUTH_FAILED",
        stage: "db_auth",
        title: `Password authentication failed for user "${t.username ?? ""}"`,
        hint: "Double-check the username and password. Passwords are case-sensitive.",
      };
    case "28000":
      return {
        code: "DB_ACCESS_REJECTED",
        stage: "db_auth",
        title: "The server rejected this login",
        hint: "Usually a pg_hba.conf rule: no entry allows this user/database/host, or it requires SSL. Ask your DBA to add a rule, or switch SSL / TLS mode to Require.",
      };
    case "3D000":
      return {
        code: "DB_DATABASE_NOT_FOUND",
        stage: "db_auth",
        title: `Database "${t.database}" does not exist`,
        hint: "Check the Database field. Run `\\l` in psql (or SELECT datname FROM pg_database) to list databases.",
      };
    case "42501":
      return {
        code: "DB_PERMISSION_DENIED",
        stage: "db_query",
        title: "Permission denied",
        hint: "The login works but this user lacks a privilege the extractor needs (CONNECT on the database or USAGE on a schema).",
      };
    case "53300":
      return {
        code: "DB_TOO_MANY_CONNECTIONS",
        stage: "db_auth",
        title: "The server has no free connection slots",
        hint: "Too many clients are connected (max_connections). Try again later or close idle sessions.",
      };
    case "57014":
      return {
        code: "DB_TIMEOUT",
        stage: "db_query",
        title: "The query was cancelled (statement timeout)",
        hint: "A catalog query exceeded the 60 s statement timeout. Try again, or exclude large schemas.",
      };
    case "57P03":
      return {
        code: "DB_SERVER_UNAVAILABLE",
        stage: "db_auth",
        title: "The database is starting up or shutting down",
        hint: "Wait a moment and test again.",
      };
  }
  if (sqlState.startsWith("28")) {
    return { code: "DB_AUTH_FAILED", stage: "db_auth", title: "Authentication failed" };
  }
  if (sqlState.startsWith("08")) {
    return { code: "DB_CONNECTION_RESET", stage: "db_network", title: "Connection failure reported by the server" };
  }
  if (sqlState.startsWith("57")) {
    return { code: "DB_SERVER_UNAVAILABLE", stage: "db_query", title: "The server cancelled or refused the operation" };
  }
  return undefined;
}

function scrub(text: string, secret?: string): string {
  return secret && secret.length >= 3 ? text.split(secret).join("[REDACTED]") : text;
}

/** Maps a `pg` / Node error to the bridge's structured error body. Keeps the driver's exact message. */
export function classifyPgError(err: unknown, target: PgTarget, during: "connect" | "query" = "connect"): BridgeErrorBody {
  const e = (err ?? {}) as { message?: string; code?: string; name?: string; errors?: unknown[] };
  // Node wraps dual-stack failures (::1 and 127.0.0.1) in an AggregateError with an empty message.
  const inner = Array.isArray(e.errors) && e.errors.length > 0 ? (e.errors[0] as typeof e) : undefined;
  const code = e.code ?? inner?.code;
  const rawMessage =
    e.message ||
    (Array.isArray(e.errors) ? e.errors.map((x) => (x as { message?: string }).message).filter(Boolean).join("; ") : "") ||
    String(err);
  const message = scrub(rawMessage, target.password);
  const isSqlState = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && !code.startsWith("E");

  let c: Classified | undefined;
  if (isSqlState) c = bySqlState(code, target);
  if (!c && code && NETWORK_CODES[code]) c = NETWORK_CODES[code](target);
  if (!c && ((code && TLS_CODES.has(code)) || /ssl|tls|certificate/i.test(rawMessage))) {
    c = {
      code: "DB_TLS_ERROR",
      stage: "db_tls",
      title: "SSL / TLS negotiation failed",
      hint: /does not support ssl/i.test(rawMessage)
        ? "The server has SSL turned off. Set SSL / TLS mode to Disable."
        : /self[- ]signed|verify|issuer|altname/i.test(rawMessage + (code ?? ""))
          ? "The server's certificate could not be verified. Use SSL / TLS mode Require (encrypts without verifying), or install the CA certificate."
          : "Try a different SSL / TLS mode (Disable / Require / Verify full).",
    };
  }
  if (!c && /timeout/i.test(rawMessage)) {
    c = {
      code: "DB_TIMEOUT",
      stage: during === "connect" ? "db_network" : "db_query",
      title: during === "connect" ? `Timed out connecting to ${target.host}:${target.port}` : "The query timed out",
      hint:
        during === "connect"
          ? "The server did not complete the handshake in time. Check host/port, firewall, and SSL mode."
          : "The catalog query took too long. Try again, or exclude large schemas.",
    };
  }
  if (!c && /terminated unexpectedly|connection terminated/i.test(rawMessage)) {
    c = NETWORK_CODES.ECONNRESET(target);
  }
  if (!c) {
    c =
      during === "query"
        ? { code: "DB_QUERY_FAILED", stage: "db_query", title: "A catalog query failed" }
        : { code: "DB_ERROR", stage: "driver", title: "The PostgreSQL driver reported an error" };
  }

  return {
    ok: false,
    code: c.code,
    stage: c.stage,
    title: c.title,
    error: message,
    hint: c.hint,
    sqlState: isSqlState ? code : undefined,
    driverCode: !isSqlState ? code : undefined,
    errorName: e.name ?? inner?.name,
  };
}
