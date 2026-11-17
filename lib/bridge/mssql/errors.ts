import type { BridgeErrorBody, FailureCode, FailureStage } from "@/lib/adapters/diagnostics";

export interface MssqlTarget {
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

const NETWORK_CODES: Record<string, (t: MssqlTarget) => Classified> = {
  ENOTFOUND: (t) => ({
    code: "DB_HOST_NOT_FOUND",
    stage: "db_network",
    title: `Host "${t.host}" could not be resolved`,
    hint: "Check the Host field for typos. If it's a name on your network or VPN, verify DNS resolution.",
  }),
  EAI_AGAIN: (t) => ({
    code: "DB_HOST_NOT_FOUND",
    stage: "db_network",
    title: `DNS lookup for "${t.host}" failed`,
    hint: "DNS is temporarily unavailable. Check your network or VPN connection.",
  }),
  ECONNREFUSED: (t) => ({
    code: "DB_CONNECTION_REFUSED",
    stage: "db_network",
    title: `Nothing is accepting connections on ${t.host}:${t.port}`,
    hint: "Make sure SQL Server is running, TCP/IP is enabled in SQL Server Configuration Manager, and port 1433 is open in firewall.",
  }),
  ETIMEDOUT: (t) => ({
    code: "DB_TIMEOUT",
    stage: "db_network",
    title: `Timed out connecting to ${t.host}:${t.port}`,
    hint: "The host did not respond. Check firewall rules, network security groups, or verify SQL Server Browser service.",
  }),
  EHOSTUNREACH: (t) => ({
    code: "DB_TIMEOUT",
    stage: "db_network",
    title: `Host ${t.host} is unreachable`,
    hint: "No network route to this host. Check routing or VPN.",
  }),
  ENETUNREACH: (t) => ({
    code: "DB_TIMEOUT",
    stage: "db_network",
    title: `Network to ${t.host} is unreachable`,
    hint: "No network route to this host. Check routing or VPN.",
  }),
  ECONNRESET: () => ({
    code: "DB_CONNECTION_RESET",
    stage: "db_network",
    title: "SQL Server closed the connection",
    hint: "The connection was reset. Check SSL settings or server logs.",
  }),
};

function bySqlServerError(number: number, t: MssqlTarget): Classified | undefined {
  switch (number) {
    case 18456:
      return {
        code: "DB_AUTH_FAILED",
        stage: "db_auth",
        title: `Login failed for user "${t.username ?? ""}"`,
        hint: "Double-check the username and password. Also verify SQL Server is configured for 'SQL Server and Windows Authentication mode' (mixed mode).",
      };
    case 4060:
      return {
        code: "DB_DATABASE_NOT_FOUND",
        stage: "db_auth",
        title: `Cannot open database "${t.database}" requested by the login`,
        hint: "Check the Database field. The database may not exist or the user does not have permission to access it.",
      };
    case 229:
    case 230:
      return {
        code: "DB_PERMISSION_DENIED",
        stage: "db_query",
        title: "Permission denied in SQL Server",
        hint: "The user lacks SELECT or VIEW DEFINITION permission on one or more catalog views.",
      };
    case 17142:
      return {
        code: "DB_SERVER_UNAVAILABLE",
        stage: "db_auth",
        title: "SQL Server is paused",
        hint: "The SQL Server service is currently paused.",
      };
  }
  return undefined;
}

function scrub(text: string, secret?: string): string {
  return secret && secret.length >= 3 ? text.split(secret).join("[REDACTED]") : text;
}

export function classifyMssqlError(
  err: unknown,
  target: MssqlTarget,
  during: "connect" | "query" = "connect",
): BridgeErrorBody {
  const e = (err ?? {}) as {
    message?: string;
    code?: string;
    number?: number;
    state?: number;
    name?: string;
  };

  const rawMessage = e.message || String(err);
  const message = scrub(rawMessage, target.password);
  const code = e.code;
  const num = typeof e.number === "number" ? e.number : undefined;

  let c: Classified | undefined;

  if (num !== undefined) c = bySqlServerError(num, target);
  if (!c && code && NETWORK_CODES[code]) c = NETWORK_CODES[code](target);

  if (!c && /login failed/i.test(rawMessage)) {
    c = {
      code: "DB_AUTH_FAILED",
      stage: "db_auth",
      title: `Login failed for user "${target.username ?? ""}"`,
      hint: "Check username and password.",
    };
  }

  if (!c && /cannot open database/i.test(rawMessage)) {
    c = {
      code: "DB_DATABASE_NOT_FOUND",
      stage: "db_auth",
      title: `Cannot open database "${target.database}"`,
      hint: "Verify that the database name exists on the SQL Server.",
    };
  }

  if (!c && /certificate|ssl|tls|encrypt/i.test(rawMessage)) {
    c = {
      code: "DB_TLS_ERROR",
      stage: "db_tls",
      title: "TLS / Encryption negotiation failed",
      hint: "SQL Server encryption required. Try setting SSL mode to Require or check certificate validity.",
    };
  }

  if (!c && /timeout/i.test(rawMessage)) {
    c = {
      code: "DB_TIMEOUT",
      stage: during === "connect" ? "db_network" : "db_query",
      title: during === "connect" ? `Timed out connecting to ${target.host}:${target.port}` : "The query timed out",
      hint: during === "connect"
        ? "Check host, port (1433), firewall, and SQL Server status."
        : "The query exceeded the timeout limit.",
    };
  }

  if (!c) {
    c =
      during === "query"
        ? { code: "DB_QUERY_FAILED", stage: "db_query", title: "A SQL Server query failed" }
        : { code: "DB_ERROR", stage: "driver", title: "The SQL Server driver reported an error" };
  }

  return {
    ok: false,
    code: c.code,
    stage: c.stage,
    title: c.title,
    error: message,
    hint: c.hint,
    driverCode: code || (num ? String(num) : undefined),
    errorName: e.name,
  };
}
