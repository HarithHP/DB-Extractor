import type { BridgeErrorBody, FailureCode, FailureStage } from "@/lib/adapters/diagnostics";

export interface MysqlTarget {
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

const NETWORK_CODES: Record<string, (t: MysqlTarget) => Classified> = {
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
    hint: "Make sure MySQL / MariaDB is running and listening on this host/port (`bind-address` and `port` in my.cnf), and that no firewall blocks it.",
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
    hint: "Often caused by an SSL mode mismatch, network proxy, or server wait_timeout reached. Try adjusting SSL / TLS mode.",
  }),
  EPIPE: () => ({
    code: "DB_CONNECTION_RESET",
    stage: "db_network",
    title: "The database server closed the connection",
  }),
};

function byErrno(errno: number, t: MysqlTarget): Classified | undefined {
  switch (errno) {
    case 1045: // ER_ACCESS_DENIED_ERROR
      return {
        code: "DB_AUTH_FAILED",
        stage: "db_auth",
        title: `Access denied for user "${t.username ?? ""}"`,
        hint: "Double-check the username and password. Also verify host permissions (e.g. user@'%' or user@'localhost').",
      };
    case 1044: // ER_DBACCESS_DENIED_ERROR
      return {
        code: "DB_ACCESS_REJECTED",
        stage: "db_auth",
        title: `Access denied for user "${t.username ?? ""}" to database "${t.database}"`,
        hint: "The login succeeded, but user lacks permission to access this database. Grant privileges with `GRANT ALL ON \`<database>\`.* TO ...`.",
      };
    case 1049: // ER_BAD_DB_ERROR
      return {
        code: "DB_DATABASE_NOT_FOUND",
        stage: "db_auth",
        title: `Unknown database "${t.database}"`,
        hint: "Check the Database field. Run `SHOW DATABASES;` in MySQL to verify the exact database name.",
      };
    case 1040: // ER_CON_COUNT_ERROR
      return {
        code: "DB_TOO_MANY_CONNECTIONS",
        stage: "db_auth",
        title: "Too many connections to the MySQL server",
        hint: "The server reached `max_connections`. Wait a moment or increase `max_connections` in my.cnf.",
      };
    case 1142: // ER_TABLEACCESS_DENIED_ERROR
    case 1143: // ER_COLUMNACCESS_DENIED_ERROR
      return {
        code: "DB_PERMISSION_DENIED",
        stage: "db_query",
        title: "Permission denied for database object",
        hint: "The user lacks SELECT or SHOW VIEW permissions on one or more tables.",
      };
    case 3024: // ER_QUERY_TIMEOUT
    case 1907: // ER_STATEMENT_TIMEOUT
      return {
        code: "DB_TIMEOUT",
        stage: "db_query",
        title: "The query was cancelled (execution timeout)",
        hint: "A catalog query exceeded the statement timeout. Try again, or exclude large schemas.",
      };
    case 1053: // ER_SERVER_SHUTDOWN
      return {
        code: "DB_SERVER_UNAVAILABLE",
        stage: "db_auth",
        title: "Server shutdown in progress",
        hint: "The MySQL server is shutting down or restarting.",
      };
  }
  return undefined;
}

function scrub(text: string, secret?: string): string {
  return secret && secret.length >= 3 ? text.split(secret).join("[REDACTED]") : text;
}

export function classifyMysqlError(
  err: unknown,
  target: MysqlTarget,
  during: "connect" | "query" = "connect",
): BridgeErrorBody {
  const e = (err ?? {}) as {
    message?: string;
    code?: string;
    errno?: number;
    sqlState?: string;
    name?: string;
  };

  const rawMessage = e.message || String(err);
  const message = scrub(rawMessage, target.password);
  const code = e.code;
  const errno = typeof e.errno === "number" ? e.errno : undefined;

  let c: Classified | undefined;

  if (errno !== undefined) c = byErrno(errno, target);
  if (!c && code && NETWORK_CODES[code]) c = NETWORK_CODES[code](target);
  if (!c && code === "PROTOCOL_CONNECTION_LOST") c = NETWORK_CODES.ECONNRESET(target);

  if (
    !c &&
    (code === "HANDSHAKE_ERROR" ||
      /ssl|tls|certificate|handshake|wrong signature/i.test(rawMessage))
  ) {
    c = {
      code: "DB_TLS_ERROR",
      stage: "db_tls",
      title: "SSL / TLS negotiation failed",
      hint: /does not support ssl/i.test(rawMessage)
        ? "The server does not support SSL. Set SSL / TLS mode to Disable."
        : "Try a different SSL / TLS mode (Disable / Require / Verify full).",
    };
  }

  if (!c && /timeout/i.test(rawMessage)) {
    c = {
      code: "DB_TIMEOUT",
      stage: during === "connect" ? "db_network" : "db_query",
      title: during === "connect" ? `Timed out connecting to ${target.host}:${target.port}` : "The query timed out",
      hint: during === "connect"
        ? "The server did not complete the connection handshake in time. Check host/port, firewall, and SSL mode."
        : "The query took too long. Try again or reduce scope.",
    };
  }

  if (!c) {
    c =
      during === "query"
        ? { code: "DB_QUERY_FAILED", stage: "db_query", title: "A database query failed" }
        : { code: "DB_ERROR", stage: "driver", title: "The MySQL driver reported an error" };
  }

  return {
    ok: false,
    code: c.code,
    stage: c.stage,
    title: c.title,
    error: message,
    hint: c.hint,
    sqlState: e.sqlState,
    driverCode: code || (errno ? String(errno) : undefined),
    errorName: e.name,
  };
}
